/** A port of `src-tauri/src/repo/relations.rs`. */

import type { Conn } from "../db";
import { AppError } from "../errors";
import { toModel, toModels } from "../rows";
import type { Family, FamilyEdge, FamilyMember, RelationInput, Relative } from "../types";
import { RELATIONSHIPS, isSelfRelationship, normaliseRelationship, tidyName } from "../util";
import * as clients from "./clients";

/**
 * How far a family may be walked. An agency's book is not a genealogy, and a
 * mistaken edge between two families should not turn one screen into the whole
 * client list.
 */
const MAX_DEPTH = 12;

const PERSON =
  "c.id AS client_id, c.client_code, c.full_name, c.date_of_birth, c.gender, c.is_archived, " +
  "(SELECT COUNT(*) FROM policies p WHERE p.client_id = c.id) AS own_policies";

/**
 * Everyone directly related to this client, both directions of the edge, with
 * `outgoing` saying which way each one is stored so the interface can read the
 * stored word aloud rather than guess its opposite.
 *
 * Ordered so that a spouse comes first and children before parents, which is the
 * order a family is described in.
 */
export function listForClient(conn: Conn, clientId: number): Relative[] {
  // The union is wrapped because a compound SELECT may only be ordered by its
  // result columns, and the order a family is described in is an expression.
  const sql =
    "SELECT client_id, client_code, full_name, relationship, outgoing, date_of_birth, " +
    "       gender, is_archived, own_policies, notes " +
    "FROM (SELECT c.id AS client_id, c.client_code AS client_code, " +
    "             c.full_name AS full_name, r.relationship AS relationship, " +
    "             1 AS outgoing, c.date_of_birth AS date_of_birth, " +
    "             c.gender AS gender, c.is_archived AS is_archived, " +
    "             (SELECT COUNT(*) FROM policies p WHERE p.client_id = c.id) AS own_policies, " +
    "             c.notes AS notes " +
    "      FROM client_relations r JOIN clients c ON c.id = r.related_client_id " +
    "      WHERE r.client_id = ? " +
    "      UNION ALL " +
    "      SELECT c.id, c.client_code, c.full_name, r.relationship, 0, " +
    "             c.date_of_birth, c.gender, c.is_archived, " +
    "             (SELECT COUNT(*) FROM policies p WHERE p.client_id = c.id), " +
    "             c.notes " +
    "      FROM client_relations r JOIN clients c ON c.id = r.client_id " +
    "      WHERE r.related_client_id = ?) " +
    "ORDER BY CASE relationship " +
    "           WHEN 'spouse' THEN 0 WHEN 'son' THEN 1 WHEN 'daughter' THEN 1 " +
    "           WHEN 'father' THEN 2 WHEN 'mother' THEN 2 ELSE 3 END, full_name";
  const rows = conn.prepare(sql).all(clientId, clientId) as Record<string, unknown>[];
  return toModels<Relative>(rows);
}

/**
 * The whole family around a client: every person reachable, and every edge
 * between the people found. `steps` on each member is the shortest walk from the
 * client asked about, so the interface can lay out the tree without repeating the
 * traversal.
 */
export function family(conn: Conn, clientId: number): Family {
  // Confirms the client exists, so an unknown id is a NotFound rather than an
  // empty family.
  clients.get(conn, clientId);

  const steps = new Map<number, number>([[clientId, 0]]);
  let frontier = [clientId];

  const neighbours = conn.prepare(
    "SELECT related_client_id AS id FROM client_relations WHERE client_id = ? " +
      "UNION " +
      "SELECT client_id FROM client_relations WHERE related_client_id = ?",
  );

  for (let depth = 1; depth <= MAX_DEPTH; depth += 1) {
    const next: number[] = [];
    for (const person of frontier) {
      const found = neighbours.all(person, person) as { id: number }[];
      for (const { id } of found) {
        if (steps.has(id)) continue;
        steps.set(id, depth);
        next.push(id);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  const person = conn.prepare(`SELECT ${PERSON} FROM clients c WHERE c.id = ?`);
  const members: FamilyMember[] = [];
  for (const [id, walked] of steps) {
    const row = person.get(id) as Record<string, unknown>;
    members.push({ ...toModel<FamilyMember>(row), steps: walked });
  }
  members.sort((a, b) => a.steps - b.steps || a.fullName.localeCompare(b.fullName));

  // Every edge among the people found, including the ones that close a loop — a
  // couple who are also each other's cousins is one family with two ways through
  // it, and dropping the second edge would draw a tree the book does not hold.
  const edges = toModels<FamilyEdge>(
    conn
      .prepare(
        "SELECT client_id, related_client_id, relationship FROM client_relations " +
          "ORDER BY client_id, related_client_id",
      )
      .all() as Record<string, unknown>[],
  ).filter((edge) => steps.has(edge.clientId) && steps.has(edge.relatedClientId));

  return { members, edges };
}

/**
 * Records how two clients are related, or corrects the word on an edge that
 * already exists in either direction.
 */
export function link(conn: Conn, input: RelationInput): void {
  if (input.clientId === input.relatedClientId) {
    throw AppError.validation("A client cannot be related to themselves");
  }
  // Strict here, tolerant in the importer below. A word arriving from the
  // interface came from a fixed list, so an unknown one is a bug worth a message
  // rather than something to quietly file under "other".
  const relationship = input.relationship.trim().toLowerCase();
  if (!RELATIONSHIPS.includes(relationship)) {
    throw AppError.validation(
      `"${input.relationship.trim()}" is not a relationship this book records`,
    );
  }

  for (const id of [input.clientId, input.relatedClientId]) clients.get(conn, id);

  // The pair is what is unique, not the direction. Somebody adding "father" on
  // the son's page when the father's page already says "son" is describing the
  // edge that is there, and would otherwise get a second row saying the opposite
  // of the first.
  const existing = conn
    .prepare(
      "SELECT client_id AS holder, related_client_id AS related FROM client_relations " +
        "WHERE (client_id = ? AND related_client_id = ?) " +
        "   OR (client_id = ? AND related_client_id = ?)",
    )
    .get(input.clientId, input.relatedClientId, input.relatedClientId, input.clientId) as
    | { holder: number; related: number }
    | undefined;

  if (existing) {
    // Rewriting the stored direction as well as the word, so that the edge says
    // what the operator just said on the page they said it on.
    conn
      .prepare("DELETE FROM client_relations WHERE client_id = ? AND related_client_id = ?")
      .run(existing.holder, existing.related);
  }

  rejectAncestryLoop(conn, input.clientId, input.relatedClientId, relationship);

  conn
    .prepare(
      "INSERT INTO client_relations (client_id, related_client_id, relationship) VALUES (?, ?, ?)",
    )
    .run(input.clientId, input.relatedClientId, relationship);
}

/**
 * Removes the edge between two clients, whichever way round it is stored. The
 * people stay: they are clients, and one of them holding a policy is ordinary.
 */
export function unlink(conn: Conn, clientId: number, relatedClientId: number): void {
  const result = conn
    .prepare(
      "DELETE FROM client_relations " +
        "WHERE (client_id = ? AND related_client_id = ?) " +
        "   OR (client_id = ? AND related_client_id = ?)",
    )
    .run(clientId, relatedClientId, relatedClientId, clientId);
  if (result.changes === 0) throw AppError.notFound("Relationship");
}

/**
 * The client ids directly related to this one, either direction. What the
 * family-wide archive and the family delete act on: one step out, so that
 * recording an in-law never widens what either of them reaches.
 */
export function immediateIds(conn: Conn, clientId: number): number[] {
  const rows = conn
    .prepare(
      "SELECT related_client_id AS id FROM client_relations WHERE client_id = ? " +
        "UNION " +
        "SELECT client_id FROM client_relations WHERE related_client_id = ?",
    )
    .all(clientId, clientId) as { id: number }[];
  return rows.map((row) => row.id);
}

/**
 * Used by the importer, which sees a name in a "members covered" column rather
 * than an id. Looks among the people already related to this client, then among
 * clients of that name, and only then creates one.
 */
export function findOrCreateRelative(
  conn: Conn,
  clientId: number,
  name: string,
  relationship: string | null,
): number {
  const tidy = tidyName(name);

  // The holder themselves, named in their own cover list. This is what the
  // 'self' member row used to be.
  const holder = conn.prepare("SELECT full_name FROM clients WHERE id = ?").get(clientId) as
    | { full_name: string }
    | undefined;
  if (!holder) throw AppError.notFound("Client");
  if (holder.full_name.toLowerCase() === tidy.toLowerCase() || isSelfRelationship(relationship)) {
    return clientId;
  }

  // Already in this family. Matching here first is what keeps a second import of
  // the same spreadsheet from adding a second Priya.
  const related = conn
    .prepare(
      "SELECT c.id AS id FROM client_relations r JOIN clients c ON c.id = r.related_client_id " +
        "WHERE r.client_id = ? AND lower(c.full_name) = lower(?) " +
        "UNION " +
        "SELECT c.id FROM client_relations r JOIN clients c ON c.id = r.client_id " +
        "WHERE r.related_client_id = ? AND lower(c.full_name) = lower(?) " +
        "LIMIT 1",
    )
    .get(clientId, tidy, clientId, tidy) as { id: number } | undefined;
  if (related) {
    // The pair stands either way. Where the file states the relationship,
    // recording it is what lets a re-import correct a book whose families came in
    // as `other` before anyone was reading the word beside the name. Silence
    // leaves the existing word alone rather than flattening it.
    if (relationship !== null && !isSelfRelationship(relationship)) {
      link(conn, {
        clientId,
        relatedClientId: related.id,
        relationship: normaliseRelationship(relationship),
      });
    }
    return related.id;
  }

  // In the book but not yet tied to this family, and unambiguously so. The same
  // rule migration 005 used: one match is a person, two are two people.
  const matches = conn
    .prepare("SELECT id FROM clients WHERE lower(full_name) = lower(?) ORDER BY id LIMIT 2")
    .all(tidy) as { id: number }[];

  const id = matches.length === 1 ? (matches[0] as { id: number }).id : createRelative(conn, clientId, tidy);

  link(conn, {
    clientId,
    relatedClientId: id,
    relationship: relationship === null ? "other" : normaliseRelationship(relationship),
  });
  return id;
}

/**
 * Opens a client for somebody named only as a life on a policy, giving them the
 * household's address the way migration 005 did: they live where the policyholder
 * lives, and the client list filters on it.
 */
function createRelative(conn: Conn, clientId: number, tidyName: string): number {
  const code = clients.nextClientCode(conn);
  const result = conn
    .prepare(
      "INSERT INTO clients (client_code, full_name, address_line1, address_line2, city, " +
        "    state, pincode, preferred_language) " +
        "SELECT ?, ?, address_line1, address_line2, city, state, pincode, preferred_language " +
        "FROM clients WHERE id = ?",
    )
    .run(code, tidyName, clientId);
  return Number(result.lastInsertRowid);
}

/**
 * Refuses an edge that would make somebody their own ancestor. Parent and child
 * edges are the ones with a direction that means something up and down a family,
 * so they are the ones that can contradict themselves; a spouse or sibling edge
 * closing a loop is a family with two ways through it, not a broken one.
 */
function rejectAncestryLoop(
  conn: Conn,
  clientId: number,
  relatedClientId: number,
  relationship: string,
): void {
  let ancestor: number;
  let descendant: number;
  switch (relationship) {
    // "related is the son of client": client is above.
    case "son":
    case "daughter":
      [ancestor, descendant] = [clientId, relatedClientId];
      break;
    // "related is the father of client": related is above.
    case "father":
    case "mother":
      [ancestor, descendant] = [relatedClientId, clientId];
      break;
    default:
      return;
  }

  // Walking up from the proposed ancestor: if the descendant is already above
  // them, the new edge would close the loop.
  const above = conn.prepare(
    "SELECT client_id AS id FROM client_relations " +
      " WHERE related_client_id = ? AND relationship IN ('son', 'daughter') " +
      "UNION " +
      "SELECT related_client_id FROM client_relations " +
      " WHERE client_id = ? AND relationship IN ('father', 'mother')",
  );

  const seen = new Set([ancestor]);
  let frontier = [ancestor];
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const next: number[] = [];
    for (const person of frontier) {
      for (const { id } of above.all(person, person) as { id: number }[]) {
        if (id === descendant) {
          throw AppError.validation(
            "That would make somebody their own ancestor. Check which way round the " +
              "relationship goes.",
          );
        }
        if (!seen.has(id)) {
          seen.add(id);
          next.push(id);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
}
