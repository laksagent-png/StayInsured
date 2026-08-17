/** A port of `src-tauri/src/repo/mod.rs`. */

import type { Conn } from "../db";
import type { Bind } from "../query";

/**
 * Sanitises free text into an FTS5 prefix query. Returns null when nothing
 * searchable is left, so callers can fall back to a LIKE scan.
 */
export function ftsQuery(search: string): string | null {
  const tokens = search
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== "")
    .map((token) => `"${token.toLowerCase()}"*`);
  return tokens.length === 0 ? null : tokens.join(" AND ");
}

export function count(conn: Conn, sql: string, params: Bind[]): number {
  const row = conn.prepare(sql).get(...params) as Record<string, number>;
  return Object.values(row)[0] ?? 0;
}

/**
 * better-sqlite3 reports a broken constraint in the message rather than in a
 * structured field, exactly as rusqlite does, so the checks that turn one into
 * advice for the operator read the same way in both editions.
 */
export function isConstraintViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT");
}

/**
 * Whether a broken constraint names every one of these columns, so that the
 * repositories can tell which rule was broken and answer with advice instead of
 * with SQLite's own wording.
 *
 * SQLite writes the columns table-qualified and in the order the index declares
 * them — `UNIQUE constraint failed: documents.client_id, documents.sha256` —
 * which makes the whole phrase a bad thing to look for: a renamed table or a
 * reordered index turns a sentence written for an operator back into that one,
 * and nothing fails until somebody reads it off a screen. Each column is matched
 * on its own and as a whole identifier, so `sha256` is not found inside a
 * `sha256_prefix` added later. The two editions link different SQLite builds and
 * this edition's, 3.43.1 through better-sqlite3, words it exactly as the
 * SQLCipher build the Rust core bundles does.
 */
export function constraintNames(message: string, columns: string[]): boolean {
  const words = message.split(/[^\p{L}\p{N}_]+/u);
  return columns.every((column) => words.includes(column));
}
