/** A port of `src-tauri/src/repo/insurers.rs`. */

import type { Conn } from "../db";
import { AppError } from "../errors";
import { blankToNull, boolToInt, toModels } from "../rows";
import type { Insurer, InsurerInput, LookupItem } from "../types";
import { isConstraintViolation } from "./shared";

const COLUMNS =
  "i.id, i.name, i.short_code, i.website, i.claim_helpline, i.support_email, " +
  "i.notes, i.is_active, (SELECT COUNT(*) FROM policies p WHERE p.insurer_id = i.id) AS policy_count";

export function list(conn: Conn, includeInactive: boolean): Insurer[] {
  const filter = includeInactive ? "" : " WHERE i.is_active = 1";
  const rows = conn.prepare(`SELECT ${COLUMNS} FROM insurers i${filter} ORDER BY i.name`).all() as Record<
    string,
    unknown
  >[];
  return toModels<Insurer>(rows);
}

/** Insurers that already carry policies, most used first — what the pickers show. */
export function lookup(conn: Conn): LookupItem[] {
  const rows = conn
    .prepare(
      "SELECT i.id, i.name AS label, i.short_code AS secondary FROM insurers i WHERE i.is_active = 1 " +
        "ORDER BY (SELECT COUNT(*) FROM policies p WHERE p.insurer_id = i.id) DESC, i.name",
    )
    .all() as Record<string, unknown>[];
  return toModels<LookupItem>(rows);
}

function fields(input: InsurerInput): (string | number | null)[] {
  const shortCode = blankToNull(input.shortCode);
  return [
    input.name.trim(),
    shortCode === null ? null : shortCode.toUpperCase(),
    blankToNull(input.website),
    blankToNull(input.claimHelpline),
    blankToNull(input.supportEmail),
    blankToNull(input.notes),
    boolToInt(input.isActive ?? true),
  ];
}

export function create(conn: Conn, input: InsurerInput): number {
  if (input.name.trim() === "") throw AppError.validation("Insurer name is required");
  try {
    const result = conn
      .prepare(
        "INSERT INTO insurers (name, short_code, website, claim_helpline, support_email, notes, is_active) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(...fields(input));
    return Number(result.lastInsertRowid);
  } catch (error) {
    throw duplicateName(error);
  }
}

export function update(conn: Conn, id: number, input: InsurerInput): void {
  if (input.name.trim() === "") throw AppError.validation("Insurer name is required");
  let changes: number;
  try {
    const result = conn
      .prepare(
        "UPDATE insurers SET name = ?, short_code = ?, website = ?, claim_helpline = ?, " +
          "support_email = ?, notes = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(...fields(input), id);
    changes = result.changes;
  } catch (error) {
    throw duplicateName(error);
  }
  if (changes === 0) throw AppError.notFound("Insurer");
}

/**
 * Refuses to delete an insurer that policies still point at; deactivating is the
 * intended way to retire one.
 */
export function remove(conn: Conn, id: number): void {
  const row = conn.prepare("SELECT COUNT(*) AS n FROM policies WHERE insurer_id = ?").get(id) as { n: number };
  if (row.n > 0) {
    throw AppError.conflict(`${row.n} policies are with this insurer. Deactivate it instead of deleting.`);
  }
  const result = conn.prepare("DELETE FROM insurers WHERE id = ?").run(id);
  if (result.changes === 0) throw AppError.notFound("Insurer");
}

/** Resolves a name from a spreadsheet to an insurer, creating one if needed. */
export function findOrCreate(conn: Conn, name: string): number {
  const trimmed = name.trim();
  if (trimmed === "") throw AppError.validation("Insurer name is missing");

  const exact = conn
    .prepare("SELECT id FROM insurers WHERE lower(name) = lower(?) OR lower(short_code) = lower(?)")
    .get(trimmed, trimmed) as { id: number } | undefined;
  if (exact) return exact.id;

  // Spreadsheets abbreviate; match on a contained name before creating a duplicate.
  const partial = conn
    .prepare(
      "SELECT id FROM insurers " +
        "WHERE lower(name) LIKE '%' || lower(?) || '%' OR lower(?) LIKE '%' || lower(name) || '%' " +
        "ORDER BY length(name) LIMIT 1",
    )
    .get(trimmed, trimmed) as { id: number } | undefined;
  if (partial) return partial.id;

  return create(conn, { name: trimmed, notes: "Added automatically during import", isActive: true });
}

function duplicateName(error: unknown): AppError {
  if (isConstraintViolation(error)) return AppError.conflict("An insurer with that name already exists");
  return AppError.database(error);
}
