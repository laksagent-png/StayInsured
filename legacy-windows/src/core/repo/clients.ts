/** A port of `src-tauri/src/repo/clients.rs`. */

import type { Conn } from "../db";
import { AppError, describe } from "../errors";
import { Conditions, likePattern, orderBy, paginate, type Bind } from "../query";
import { blankToNull, boolToInt, toModel, toModels } from "../rows";
import type { Client, ClientFilter, ClientInput, Page } from "../types";
import { looksLikeEmail, normalisePhone, parseDate, tidyName } from "../util";
import { immediateIds } from "./relations";
import { count, ftsQuery, isConstraintViolation } from "./shared";

const SORTABLE: Record<string, string> = {
  name: "c.full_name",
  code: "c.client_code",
  city: "c.city",
  created: "c.created_at",
  updated: "c.updated_at",
  policies: "total_policies",
  nextExpiry: "next_expiry",
};

const COLUMNS =
  "c.id, c.client_code, c.full_name, c.email, c.phone, c.alt_phone, " +
  "c.date_of_birth, c.gender, c.address_line1, c.address_line2, c.city, c.state, c.pincode, " +
  "c.occupation, c.pan, c.gstin, c.preferred_language, c.reminders_opted_out, c.notes, " +
  "c.is_archived, c.created_at, c.updated_at";

const DERIVED =
  "(SELECT COUNT(*) FROM policies p WHERE p.client_id = c.id AND p.status = 'active') AS active_policies, " +
  "(SELECT COUNT(*) FROM policies p WHERE p.client_id = c.id) AS total_policies, " +
  "(SELECT MIN(p.expiry_date) FROM policies p WHERE p.client_id = c.id " +
  "   AND p.expiry_date >= date('now', 'localtime')) AS next_expiry, " +
  "(SELECT COUNT(*) FROM client_relations r " +
  "   WHERE r.client_id = c.id OR r.related_client_id = c.id) AS relatives, " +
  "(SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM policies p WHERE p.client_id = c.id) " +
  "              AND EXISTS (SELECT 1 FROM client_relations r WHERE r.related_client_id = c.id) " +
  "             THEN 1 ELSE 0 END) AS is_dependent";

/**
 * A client with no policy of their own who is listed under somebody else — a
 * spouse on a floater, a dependent child. They are clients like any other and the
 * book holds them once, but a list of two thousand names where half are children
 * is not the book an agent works from, so browsing hides them.
 *
 * The dashboard counts through this too: a child with no email address is not a
 * client the agency is failing to reach.
 */
export const IS_DEPENDENT =
  "NOT EXISTS (SELECT 1 FROM policies p WHERE p.client_id = c.id) " +
  "AND EXISTS (SELECT 1 FROM client_relations r WHERE r.related_client_id = c.id)";

function buildConditions(filter: ClientFilter): Conditions {
  const c = new Conditions();

  if (!filter.includeArchived) c.addRaw("c.is_archived = 0");

  const search = filter.search?.trim();

  // Searching reaches everybody. Someone typing a child's name is looking for
  // that child, and a book that held them but would not admit it when asked by
  // name would be worse than one that never held them at all.
  if (!filter.includeFamily && !search) c.addRaw(`NOT (${IS_DEPENDENT})`);

  if (search) {
    const query = ftsQuery(search);
    if (query !== null) {
      c.add("c.id IN (SELECT rowid FROM clients_fts WHERE clients_fts MATCH ?)", query);
    } else {
      const pattern = likePattern(search);
      c.addMany("(c.full_name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')", [pattern, pattern]);
    }
  }

  const city = blankToNull(filter.city);
  if (city) c.add("c.city = ?", city);
  const state = blankToNull(filter.state);
  if (state) c.add("c.state = ?", state);
  const category = blankToNull(filter.category);
  if (category) {
    c.add("EXISTS (SELECT 1 FROM policies p WHERE p.client_id = c.id AND p.category = ?)", category);
  }
  if (filter.missingEmail) c.addRaw("(c.email IS NULL OR c.email = '')");

  return c;
}

export function list(conn: Conn, filter: ClientFilter): Page<Client> {
  const conditions = buildConditions(filter);
  const whereSql = conditions.whereSql();

  const total = count(conn, `SELECT COUNT(*) AS n FROM clients c${whereSql}`, conditions.params());

  const { page, pageSize, limit, offset } = paginate(filter.page, filter.pageSize);
  const order = orderBy(filter.sort, filter.descending ?? false, SORTABLE, "c.full_name");

  const rows = conn
    .prepare(`SELECT ${COLUMNS}, ${DERIVED} FROM clients c${whereSql}${order} LIMIT ? OFFSET ?`)
    .all(...conditions.paramsWith([limit, offset])) as Record<string, unknown>[];

  return { rows: toModels<Client>(rows), total, page, pageSize };
}

export function get(conn: Conn, id: number): Client {
  const row = conn
    .prepare(`SELECT ${COLUMNS}, ${DERIVED} FROM clients c WHERE c.id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) throw AppError.notFound("Client");
  return toModel<Client>(row);
}

export function nextClientCode(conn: Conn): string {
  const row = conn
    .prepare(
      "SELECT IFNULL(MAX(CAST(substr(client_code, 4) AS INTEGER)), 0) + 1 AS next " +
        "FROM clients WHERE client_code GLOB 'CL-[0-9]*'",
    )
    .get() as { next: number };
  return `CL-${`${row.next}`.padStart(5, "0")}`;
}

function validate(input: ClientInput): void {
  if (input.fullName.trim() === "") throw AppError.validation("Client name is required");

  const email = blankToNull(input.email);
  if (email !== null && !looksLikeEmail(email)) {
    throw AppError.validation(`"${email}" is not a valid email address`);
  }

  const dob = blankToNull(input.dateOfBirth);
  if (dob !== null && parseDate(dob) === null) {
    throw AppError.validation("Date of birth is not a valid date");
  }
}

/** The column values shared by create and update, in the order both statements bind them. */
function fields(input: ClientInput): Bind[] {
  const dob = blankToNull(input.dateOfBirth);
  const pan = blankToNull(input.pan);
  const gstin = blankToNull(input.gstin);
  return [
    tidyName(input.fullName),
    blankToNull(input.email),
    input.phone ? normalisePhone(input.phone) : null,
    input.altPhone ? normalisePhone(input.altPhone) : null,
    dob === null ? null : parseDate(dob),
    blankToNull(input.gender),
    blankToNull(input.addressLine1),
    blankToNull(input.addressLine2),
    blankToNull(input.city),
    blankToNull(input.state),
    blankToNull(input.pincode),
    blankToNull(input.occupation),
    pan === null ? null : pan.toUpperCase(),
    gstin === null ? null : gstin.toUpperCase(),
    input.preferredLanguage ?? "en",
    boolToInt(input.remindersOptedOut),
    blankToNull(input.notes),
  ];
}

export function create(conn: Conn, input: ClientInput): number {
  validate(input);
  const code = blankToNull(input.clientCode) ?? nextClientCode(conn);

  try {
    const result = conn
      .prepare(
        "INSERT INTO clients (client_code, full_name, email, phone, alt_phone, date_of_birth, " +
          "gender, address_line1, address_line2, city, state, pincode, occupation, pan, gstin, " +
          "preferred_language, reminders_opted_out, notes) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(code, ...fields(input));
    return Number(result.lastInsertRowid);
  } catch (error) {
    throw mapUniqueError(error);
  }
}

export function update(conn: Conn, id: number, input: ClientInput): void {
  validate(input);

  let changes: number;
  try {
    const result = conn
      .prepare(
        "UPDATE clients SET full_name = ?, email = ?, phone = ?, alt_phone = ?, " +
          "date_of_birth = ?, gender = ?, address_line1 = ?, address_line2 = ?, " +
          "city = ?, state = ?, pincode = ?, occupation = ?, pan = ?, gstin = ?, " +
          "preferred_language = ?, reminders_opted_out = ?, notes = ?, " +
          "client_code = COALESCE(?, client_code) WHERE id = ?",
      )
      .run(...fields(input), blankToNull(input.clientCode), id);
    changes = result.changes;
  } catch (error) {
    throw mapUniqueError(error);
  }

  if (changes === 0) throw AppError.notFound("Client");
}

export function setArchived(conn: Conn, id: number, archived: boolean): void {
  const result = conn.prepare("UPDATE clients SET is_archived = ? WHERE id = ?").run(boolToInt(archived), id);
  if (result.changes === 0) throw AppError.notFound("Client");
}

/**
 * Archives or restores a client together with the people directly related to
 * them, and answers with how many rows it moved.
 *
 * One step out, deliberately. A family has no boundary of its own — it is
 * whoever the edges reach — so an operation that walked the whole graph would
 * grow every time an in-law was recorded, and putting one household away would
 * eventually put away half the book.
 */
export function setFamilyArchived(conn: Conn, id: number, archived: boolean): number {
  get(conn, id);
  const ids = [...immediateIds(conn, id), id];

  let moved = 0;
  for (const person of ids) {
    moved += conn
      .prepare("UPDATE clients SET is_archived = ? WHERE id = ? AND is_archived <> ?")
      .run(boolToInt(archived), person, boolToInt(archived)).changes;
  }
  return moved;
}

/**
 * Removes the client together with their policies and documents. Relationship
 * edges go with them, but the people on the other end do not: they are clients,
 * and one of them holding cover of their own is the ordinary case.
 *
 * The UI confirms first, naming who is involved; the archive flag is the softer
 * option offered alongside it.
 */
export function remove(conn: Conn, id: number): void {
  const result = conn.prepare("DELETE FROM clients WHERE id = ?").run(id);
  if (result.changes === 0) throw AppError.notFound("Client");
}

/**
 * Removes the client and the people directly related to them, answering with
 * every id it deleted so the interface can say what went.
 *
 * Reaches one step out for the same reason `setFamilyArchived` does. What it
 * deletes is therefore the family as it stood when the operator was shown the
 * list, not whatever the graph grows into later.
 */
export function removeWithImmediateFamily(conn: Conn, id: number): number[] {
  get(conn, id);
  const ids = [...immediateIds(conn, id), id];

  const deleted: number[] = [];
  for (const person of ids) {
    if (conn.prepare("DELETE FROM clients WHERE id = ?").run(person).changes > 0) {
      deleted.push(person);
    }
  }
  return deleted;
}

export function distinctCities(conn: Conn): string[] {
  const rows = conn
    .prepare("SELECT DISTINCT city FROM clients WHERE city IS NOT NULL AND city <> '' ORDER BY city")
    .all() as { city: string }[];
  return rows.map((row) => row.city);
}

/**
 * Finds an existing client by code, then email, then phone, then name — used by
 * the importer to decide between updating and inserting.
 */
export function findMatch(
  conn: Conn,
  code: string | null,
  email: string | null,
  phone: string | null,
  name: string,
): number | null {
  const attempts: [string, string | null][] = [
    ["SELECT id FROM clients WHERE client_code = ?", code],
    ["SELECT id FROM clients WHERE lower(email) = lower(?)", email],
    ["SELECT id FROM clients WHERE phone = ?", phone],
  ];

  for (const [sql, value] of attempts) {
    if (!value) continue;
    const row = conn.prepare(sql).get(value) as { id: number } | undefined;
    if (row) return row.id;
  }

  const row = conn.prepare("SELECT id FROM clients WHERE lower(full_name) = lower(?)").get(name) as
    | { id: number }
    | undefined;
  return row?.id ?? null;
}

function mapUniqueError(error: unknown): AppError {
  if (isConstraintViolation(error) && describe(error).includes("client_code")) {
    return AppError.conflict("That client code is already in use");
  }
  return AppError.database(error);
}
