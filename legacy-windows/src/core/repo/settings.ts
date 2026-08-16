/** A port of `src-tauri/src/repo/settings.rs`. */

import type { Conn } from "../db";

export function all(conn: Conn): Record<string, string> {
  const rows = conn.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export function get(conn: Conn, key: string): string | null {
  const row = conn.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

/** An empty setting counts as unset, so a cleared field falls back to the default. */
export function getOr(conn: Conn, key: string, fallback: string): string {
  const value = get(conn, key);
  return value === null || value === "" ? fallback : value;
}

export function getInt(conn: Conn, key: string, fallback: number): number {
  const value = get(conn, key);
  if (value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function put(conn: Conn, key: string, value: string): void {
  conn
    .prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    )
    .run(key, value);
}

export function putMany(conn: Conn, values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) put(conn, key, value);
}
