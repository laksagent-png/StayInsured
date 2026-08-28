/**
 * A port of `src-tauri/src/repo/groups.rs`.
 *
 * Groups: a named folder of clients, and the referrer who introduced them.
 *
 * This is the deliberate opposite of `relations.ts`. A family is not stored
 * anywhere — it is whoever the edges reach, a person is in several at once, and
 * the operations on it stop one step out because it has no edge of its own to
 * stop at. A group has that edge. It is named, entered on purpose, holds a client
 * at a time, and can be listed, summed, archived and deleted as itself.
 *
 * The referrer is held apart from the membership. Whoever brought the group in is
 * a client the agency deals with, but they are not thereby part of the book the
 * group represents: the rollups sum the members, and the group archive moves the
 * members, so an introducer who placed ten firms is not archived along with them
 * and their own policies are not counted as the group's.
 */

import type { Conn } from "../db";
import { AppError, describe } from "../errors";
import { Conditions, likePattern, orderBy, paginate } from "../query";
import { blankToNull, boolToInt, toModel, toModels } from "../rows";
import type { Group, GroupFilter, GroupInput, Page } from "../types";
import * as clients from "./clients";
import { count, isConstraintViolation } from "./shared";

const SORTABLE: Record<string, string> = {
  name: "g.name",
  code: "g.group_code",
  members: "members",
  policies: "total_policies",
  premium: "premium_under_management",
  nextExpiry: "next_expiry",
  created: "g.created_at",
  updated: "g.updated_at",
};

const COLUMNS =
  "g.id, g.group_code, g.name, g.head_client_id, " +
  "(SELECT h.full_name FROM clients h WHERE h.id = g.head_client_id) AS head_name, " +
  "(SELECT h.client_code FROM clients h WHERE h.id = g.head_client_id) AS head_client_code, " +
  "g.notes, g.is_archived, g.created_at, g.updated_at";

/**
 * The group's book, summed over its members. The referrer contributes nothing
 * unless they are also in the group, which is the point of holding headship and
 * membership in separate columns.
 */
const DERIVED =
  "(SELECT COUNT(*) FROM clients c WHERE c.group_id = g.id) AS members, " +
  "(SELECT COUNT(*) FROM policies p JOIN clients c ON c.id = p.client_id " +
  "   WHERE c.group_id = g.id AND p.status = 'active') AS active_policies, " +
  "(SELECT COUNT(*) FROM policies p JOIN clients c ON c.id = p.client_id " +
  "   WHERE c.group_id = g.id) AS total_policies, " +
  "(SELECT IFNULL(SUM(p.premium_amount), 0) FROM policies p JOIN clients c ON c.id = p.client_id " +
  "   WHERE c.group_id = g.id AND p.status = 'active') AS premium_under_management, " +
  "(SELECT MIN(p.expiry_date) FROM policies p JOIN clients c ON c.id = p.client_id " +
  "   WHERE c.group_id = g.id AND p.expiry_date >= date('now', 'localtime')) AS next_expiry";

function buildConditions(filter: GroupFilter): Conditions {
  const c = new Conditions();

  if (!filter.includeArchived) c.addRaw("g.is_archived = 0");

  // Headship read from the referrer's end. Their page needs the groups they
  // brought in, and the group list already knows how to answer that.
  if (filter.headClientId != null) c.add("g.head_client_id = ?", filter.headClientId);

  // A small table, so a LIKE scan is the right tool and there is no FTS index to
  // keep in step. The referrer's name is searched too: an operator looking for
  // "the firms Mehta brought us" knows the introducer, not the folder.
  const search = blankToNull(filter.search);
  if (search) {
    const pattern = likePattern(search);
    c.addMany(
      "(g.name LIKE ? ESCAPE '\\' OR g.group_code LIKE ? ESCAPE '\\' " +
        " OR EXISTS (SELECT 1 FROM clients h WHERE h.id = g.head_client_id " +
        "              AND h.full_name LIKE ? ESCAPE '\\'))",
      [pattern, pattern, pattern],
    );
  }

  return c;
}

export function list(conn: Conn, filter: GroupFilter): Page<Group> {
  const conditions = buildConditions(filter);
  const whereSql = conditions.whereSql();

  const total = count(
    conn,
    `SELECT COUNT(*) AS n FROM client_groups g${whereSql}`,
    conditions.params(),
  );

  const { page, pageSize, limit, offset } = paginate(filter.page, filter.pageSize);
  const order = orderBy(filter.sort, filter.descending ?? false, SORTABLE, "g.name");

  const rows = conn
    .prepare(
      `SELECT ${COLUMNS}, ${DERIVED} FROM client_groups g${whereSql}${order} LIMIT ? OFFSET ?`,
    )
    .all(...conditions.paramsWith([limit, offset])) as Record<string, unknown>[];

  return { rows: toModels<Group>(rows), total, page, pageSize };
}

export function get(conn: Conn, id: number): Group {
  const row = conn
    .prepare(`SELECT ${COLUMNS}, ${DERIVED} FROM client_groups g WHERE g.id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) throw AppError.notFound("Group");
  return toModel<Group>(row);
}

/**
 * `GR-00001` upward, allocated the way client codes are so that the two read as
 * one book rather than as two numbering schemes that happen to share a screen.
 */
export function nextGroupCode(conn: Conn): string {
  const row = conn
    .prepare(
      "SELECT IFNULL(MAX(CAST(substr(group_code, 4) AS INTEGER)), 0) + 1 AS next " +
        "FROM client_groups WHERE group_code GLOB 'GR-[0-9]*'",
    )
    .get() as { next: number };
  return `GR-${`${row.next}`.padStart(5, "0")}`;
}

/**
 * A group names the client who introduced it. That is what a group head is, so a
 * group opened without one is not a group with a blank field — it is a referral
 * nobody recorded, and the book is the only place that record exists.
 *
 * The column is still nullable, because deleting the referrer must leave the
 * group standing. Editing such a group asks for the new referrer by name.
 */
function validate(conn: Conn, input: GroupInput): void {
  if (input.name.trim() === "") throw AppError.validation("Group name is required");

  if (input.headClientId == null) {
    throw AppError.validation("A group needs a group head — the client who referred it");
  }
  try {
    clients.get(conn, input.headClientId);
  } catch {
    throw AppError.validation("The group head named here is not a client in the book");
  }
}

export function create(conn: Conn, input: GroupInput): number {
  validate(conn, input);
  const code = blankToNull(input.groupCode) ?? nextGroupCode(conn);

  try {
    const result = conn
      .prepare(
        "INSERT INTO client_groups (group_code, name, head_client_id, notes) VALUES (?, ?, ?, ?)",
      )
      .run(code, input.name.trim(), input.headClientId ?? null, blankToNull(input.notes));
    return Number(result.lastInsertRowid);
  } catch (error) {
    throw mapUniqueError(error);
  }
}

/**
 * The importer's door into the same table, matching on the name and opening a
 * group when the book has none by that name.
 *
 * `create` refuses a group with no head, because a group is a referral and this
 * book is the only place that referral is written down. A spreadsheet is the one
 * caller that can honestly say it does not know: it carries the grouping — which
 * companies file together — and carries nothing at all about who introduced
 * them. So this leaves the head NULL, which is not a new state to explain. It is
 * exactly what a group becomes when its referrer is deleted, and the group page
 * already meets it by asking for a new referrer by name. Refusing the row
 * instead would throw away the grouping the sheet does know in order to protect
 * a fact it was never going to carry.
 */
export function findOrCreateByName(conn: Conn, name: string): number {
  const trimmed = name.trim();
  if (trimmed === "") throw AppError.validation("Group name is required");

  const existing = conn
    .prepare("SELECT id FROM client_groups WHERE lower(name) = lower(?)")
    .get(trimmed) as { id: number } | undefined;
  if (existing !== undefined) return existing.id;

  const code = nextGroupCode(conn);
  try {
    const result = conn
      .prepare("INSERT INTO client_groups (group_code, name, head_client_id) VALUES (?, ?, NULL)")
      .run(code, trimmed);
    return Number(result.lastInsertRowid);
  } catch (error) {
    throw mapUniqueError(error);
  }
}

export function update(conn: Conn, id: number, input: GroupInput): void {
  validate(conn, input);

  let changes: number;
  try {
    const result = conn
      .prepare(
        "UPDATE client_groups SET name = ?, head_client_id = ?, notes = ?, " +
          "group_code = COALESCE(?, group_code) WHERE id = ?",
      )
      .run(
        input.name.trim(),
        input.headClientId ?? null,
        blankToNull(input.notes),
        blankToNull(input.groupCode),
        id,
      );
    changes = result.changes;
  } catch (error) {
    throw mapUniqueError(error);
  }

  if (changes === 0) throw AppError.notFound("Group");
}

/**
 * Archives or restores the group and every client in it, answering with how many
 * clients it moved.
 *
 * It moves the members and stops. The referrer is not in the group unless they
 * joined it, and putting away a book they introduced is no reason to put away the
 * person who introduced it. Unlike the family archive this needs no depth limit:
 * the group row says exactly who is in it, which is the whole reason for keeping
 * one.
 */
export function setArchived(conn: Conn, id: number, archived: boolean): number {
  get(conn, id);

  conn.prepare("UPDATE client_groups SET is_archived = ? WHERE id = ?").run(boolToInt(archived), id);

  return conn
    .prepare("UPDATE clients SET is_archived = ? WHERE group_id = ? AND is_archived <> ?")
    .run(boolToInt(archived), id, boolToInt(archived)).changes;
}

/**
 * Removes the group and answers with how many clients it let go.
 *
 * The clients stay. A group is a folder: emptying the filing cabinet of one
 * folder does not empty it of the papers, and every company in a group is a
 * client holding its own policies. `clients.group_id` is `ON DELETE SET NULL`, so
 * the release happens in the schema rather than in a loop that could stop
 * halfway.
 */
export function remove(conn: Conn, id: number): number {
  const row = conn
    .prepare("SELECT COUNT(*) AS n FROM clients WHERE group_id = ?")
    .get(id) as { n: number };

  const result = conn.prepare("DELETE FROM client_groups WHERE id = ?").run(id);
  if (result.changes === 0) throw AppError.notFound("Group");
  return row.n;
}

/**
 * Puts a client into a group, or takes them out of one with `null`.
 *
 * This is the only place membership is said out loud. `clients.update` coalesces
 * `group_id` so that a client form which knows nothing about groups cannot empty
 * one by saving a name change, which leaves exactly one operation that can move
 * somebody — and it is the one the group screens call.
 */
export function setClientGroup(conn: Conn, clientId: number, groupId: number | null): void {
  clients.get(conn, clientId);
  if (groupId != null) get(conn, groupId);

  conn.prepare("UPDATE clients SET group_id = ? WHERE id = ?").run(groupId, clientId);
}

function mapUniqueError(error: unknown): AppError {
  if (isConstraintViolation(error)) {
    return describe(error).includes("group_code")
      ? AppError.conflict("That group code is already in use")
      : AppError.conflict("A group with that name already exists");
  }
  return AppError.database(error);
}
