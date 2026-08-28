/**
 * A port of `src-tauri/src/repo/groups.rs`.
 *
 * Groups: a named folder of clients, and the person who introduced them.
 *
 * This is the deliberate opposite of `relations.ts`. A family is not stored
 * anywhere — it is whoever the edges reach, a person is in several at once, and
 * the operations on it stop one step out because it has no edge of its own to
 * stop at. A group has that edge. It is named, entered on purpose, holds a client
 * at a time, and can be listed, summed, archived and deleted as itself.
 *
 * The head is a contact, not a client. A referrer is usually a broker, an HR
 * manager or an accountant — somebody to ring and nobody to insure — so their
 * name and their number are written on the group rather than filed as a client
 * who would then be counted, listed and exported as part of the book.
 */

import type { Conn } from "../db";
import { AppError, describe } from "../errors";
import { Conditions, likePattern, orderBy, paginate } from "../query";
import { blankToNull, boolToInt, toModel, toModels } from "../rows";
import type { Group, GroupFilter, GroupInput, Page } from "../types";
import { looksLikeEmail, normalisePhone, tidyName } from "../util";
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
  "g.id, g.group_code, g.name, g.head_name, g.head_designation, g.head_phone, g.head_email, " +
  "g.notes, g.is_archived, g.created_at, g.updated_at";

/**
 * The group's book, summed over its members. The head is not one of them: they
 * are a name and a phone number on the folder, and the folder holds companies.
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

  // A small table, so a LIKE scan is the right tool and there is no FTS index to
  // keep in step. The head's name is searched too: an operator looking for "the
  // firms Mehta brought us" knows the introducer, not the folder.
  const search = blankToNull(filter.search);
  if (search) {
    const pattern = likePattern(search);
    c.addMany(
      "(g.name LIKE ? ESCAPE '\\' OR g.group_code LIKE ? ESCAPE '\\' " +
        " OR g.head_name LIKE ? ESCAPE '\\')",
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
 * Only the name is asked for. An agent often knows that a set of firms files
 * together long before they can say who introduced them, and a group with nobody
 * named is an honest record of that rather than a form half filled in.
 *
 * The head's phone and email go through the checks a client's do, because they
 * are dialled and written to by the same person on the same screen.
 */
function validate(input: GroupInput): void {
  if (input.name.trim() === "") throw AppError.validation("Group name is required");

  const email = blankToNull(input.headEmail);
  if (email !== null && !looksLikeEmail(email)) {
    throw AppError.validation("The group head's email is not an address");
  }
}

/** The four head columns, in the order every statement here binds them. */
function headFields(input: GroupInput): (string | null)[] {
  const name = blankToNull(input.headName);
  return [
    name === null ? null : tidyName(name),
    blankToNull(input.headDesignation),
    input.headPhone ? normalisePhone(input.headPhone) : null,
    blankToNull(input.headEmail),
  ];
}

export function create(conn: Conn, input: GroupInput): number {
  validate(input);
  const code = blankToNull(input.groupCode) ?? nextGroupCode(conn);

  try {
    const result = conn
      .prepare(
        "INSERT INTO client_groups " +
          "(group_code, name, head_name, head_designation, head_phone, head_email, notes) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(code, input.name.trim(), ...headFields(input), blankToNull(input.notes));
    return Number(result.lastInsertRowid);
  } catch (error) {
    throw mapUniqueError(error);
  }
}

/**
 * The importer's door into the same table, matching on the name and opening a
 * group when the book has none by that name.
 *
 * A spreadsheet carries the grouping — which companies file together — and
 * nothing at all about who introduced them, so the head is left blank and the
 * group page asks for it later.
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
      .prepare("INSERT INTO client_groups (group_code, name) VALUES (?, ?)")
      .run(code, trimmed);
    return Number(result.lastInsertRowid);
  } catch (error) {
    throw mapUniqueError(error);
  }
}

export function update(conn: Conn, id: number, input: GroupInput): void {
  validate(input);

  let changes: number;
  try {
    const result = conn
      .prepare(
        "UPDATE client_groups SET name = ?, head_name = ?, head_designation = ?, " +
          "head_phone = ?, head_email = ?, notes = ?, " +
          "group_code = COALESCE(?, group_code) WHERE id = ?",
      )
      .run(
        input.name.trim(),
        ...headFields(input),
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
 * It moves the members and stops. The head is a contact written on the folder
 * rather than a client in it, so there is nobody else to put away. Unlike the
 * family archive this needs no depth limit: the group row says exactly who is in
 * it, which is the whole reason for keeping one.
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
