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
