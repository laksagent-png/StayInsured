/** A port of `src-tauri/src/repo/members.rs`. */

import type { Conn } from "../db";
import { AppError } from "../errors";
import { blankToNull, toModels } from "../rows";
import type { InsuredMember, MemberInput } from "../types";
import { normaliseRelationship, parseDate, tidyName } from "../util";

const COLUMNS = "id, client_id, full_name, relationship, date_of_birth, gender, notes";

export function listForClient(conn: Conn, clientId: number): InsuredMember[] {
  const rows = conn
    .prepare(
      `SELECT ${COLUMNS} FROM insured_members WHERE client_id = ? ` +
        // The proposer first, then their spouse, then everyone else by name: the
        // order a family policy is read out in.
        "ORDER BY CASE relationship WHEN 'self' THEN 0 WHEN 'spouse' THEN 1 ELSE 2 END, full_name",
    )
    .all(clientId) as Record<string, unknown>[];
  return toModels<InsuredMember>(rows);
}

function fields(input: MemberInput): (string | number | null)[] {
  const dob = blankToNull(input.dateOfBirth);
  return [
    tidyName(input.fullName),
    input.relationship ? normaliseRelationship(input.relationship) : "other",
    dob === null ? null : parseDate(dob),
    blankToNull(input.gender),
    blankToNull(input.notes),
  ];
}

export function create(conn: Conn, input: MemberInput): number {
  if (input.fullName.trim() === "") throw AppError.validation("Member name is required");
  const result = conn
    .prepare(
      "INSERT INTO insured_members (client_id, full_name, relationship, date_of_birth, gender, notes) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(input.clientId, ...fields(input));
  return Number(result.lastInsertRowid);
}

export function update(conn: Conn, id: number, input: MemberInput): void {
  if (input.fullName.trim() === "") throw AppError.validation("Member name is required");
  const result = conn
    .prepare(
      "UPDATE insured_members SET full_name = ?, relationship = ?, date_of_birth = ?, " +
        "gender = ?, notes = ? WHERE id = ?",
    )
    .run(...fields(input), id);
  if (result.changes === 0) throw AppError.notFound("Member");
}

export function remove(conn: Conn, id: number): void {
  const result = conn.prepare("DELETE FROM insured_members WHERE id = ?").run(id);
  if (result.changes === 0) throw AppError.notFound("Member");
}

/** Used by the importer, which sees a member name rather than an id. */
export function findOrCreate(
  conn: Conn,
  clientId: number,
  name: string,
  relationship: string | null,
): number {
  const tidy = tidyName(name);
  const existing = conn
    .prepare("SELECT id FROM insured_members WHERE client_id = ? AND lower(full_name) = lower(?)")
    .get(clientId, tidy) as { id: number } | undefined;
  if (existing) return existing.id;

  return create(conn, { clientId, fullName: tidy, relationship });
}
