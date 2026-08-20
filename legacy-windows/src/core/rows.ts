/**
 * Turning a SQLite row into the shape the interface expects.
 *
 * The Rust core reads rows by position — `row.get(17)?` — because rusqlite gives
 * it nothing better. better-sqlite3 hands back a row keyed by column name, so
 * this edition maps by name instead. That is a deliberate divergence: a column
 * added to the middle of a SELECT breaks the Rust mapping loudly at compile time,
 * while thirty-six hand-counted indexes in TypeScript would break quietly at
 * runtime, and the point of naming them is that they cannot slip.
 *
 * SQLite has no boolean, so the columns that mean yes or no are listed here and
 * come back as booleans. Everything else is passed through as SQLite typed it.
 */

const BOOLEAN_COLUMNS = new Set([
  "is_active",
  "is_archived",
  "is_dependent",
  "is_renewed",
  // Which way round a relationship is stored, which is a yes or no like the rest
  // even though it is derived by the query rather than held in a column.
  "outgoing",
  "reminders_opted_out",
]);

function camelCase(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

export function toModel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    out[camelCase(column)] = BOOLEAN_COLUMNS.has(column) ? value !== 0 && value !== null : value;
  }
  return out as T;
}

export function toModels<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((row) => toModel<T>(row));
}

/**
 * Blank strings from a form become NULL, so that unique indexes and the
 * "missing email" filter behave predictably. `blank_to_none` in `models.rs`.
 */
export function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** SQLite takes 1 and 0, and `undefined` is not a bindable value. */
export function boolToInt(value: boolean | null | undefined): number {
  return value ? 1 : 0;
}

export function numberOrNull(value: number | null | undefined): number | null {
  return value === undefined || value === null || Number.isNaN(value) ? null : value;
}
