/** A port of `src-tauri/src/repo/products.rs`. */

import type { Conn } from "../db";
import { AppError } from "../errors";
import type { Bind } from "../query";
import { blankToNull, boolToInt, toModels } from "../rows";
import type { Product, ProductInput } from "../types";
import { CATEGORIES } from "../util";
import { isConstraintViolation } from "./shared";

const COLUMNS =
  "p.id, p.insurer_id, i.name AS insurer_name, p.name, p.category, p.code, " +
  "p.notes, p.is_active, (SELECT COUNT(*) FROM policies po WHERE po.product_id = p.id) AS policy_count";

export function list(conn: Conn, insurerId: number | null, includeInactive: boolean): Product[] {
  const clauses: string[] = [];
  const params: Bind[] = [];
  if (!includeInactive) clauses.push("p.is_active = 1");
  if (insurerId != null) {
    // Bound rather than written into the SQL. `products.rs` interpolates it, which
    // is safe there because Rust has already proved it is an integer; nothing has
    // proved that about a number arriving from a renderer.
    clauses.push("p.insurer_id = ?");
    params.push(insurerId);
  }
  const whereSql = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;

  const rows = conn
    .prepare(
      `SELECT ${COLUMNS} FROM products p JOIN insurers i ON i.id = p.insurer_id${whereSql} ORDER BY i.name, p.name`,
    )
    .all(...params) as Record<string, unknown>[];
  return toModels<Product>(rows);
}

function validate(input: ProductInput): void {
  if (input.name.trim() === "") throw AppError.validation("Plan name is required");
  if (!(CATEGORIES as readonly string[]).includes(input.category)) {
    throw AppError.validation(`"${input.category}" is not a known category`);
  }
}

function fields(input: ProductInput): Bind[] {
  return [
    input.insurerId,
    input.name.trim(),
    input.category,
    blankToNull(input.code),
    blankToNull(input.notes),
    boolToInt(input.isActive ?? true),
  ];
}

export function create(conn: Conn, input: ProductInput): number {
  validate(input);
  try {
    const result = conn
      .prepare(
        "INSERT INTO products (insurer_id, name, category, code, notes, is_active) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(...fields(input));
    return Number(result.lastInsertRowid);
  } catch (error) {
    throw duplicate(error);
  }
}

export function update(conn: Conn, id: number, input: ProductInput): void {
  validate(input);
  let changes: number;
  try {
    const result = conn
      .prepare(
        "UPDATE products SET insurer_id = ?, name = ?, category = ?, code = ?, notes = ?, " +
          "is_active = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(...fields(input), id);
    changes = result.changes;
  } catch (error) {
    throw duplicate(error);
  }
  if (changes === 0) throw AppError.notFound("Plan");
}

export function remove(conn: Conn, id: number): void {
  const result = conn.prepare("DELETE FROM products WHERE id = ?").run(id);
  if (result.changes === 0) throw AppError.notFound("Plan");
}

export function findOrCreate(
  conn: Conn,
  insurerId: number,
  name: string,
  category: string,
): number | null {
  const trimmed = name.trim();
  if (trimmed === "") return null;

  const existing = conn
    .prepare("SELECT id FROM products WHERE insurer_id = ? AND lower(name) = lower(?)")
    .get(insurerId, trimmed) as { id: number } | undefined;
  if (existing) return existing.id;

  return create(conn, {
    insurerId,
    name: trimmed,
    category,
    notes: "Added automatically during import",
    isActive: true,
  });
}

function duplicate(error: unknown): AppError {
  if (isConstraintViolation(error)) {
    return AppError.conflict("This insurer already has a plan with that name");
  }
  return AppError.database(error);
}
