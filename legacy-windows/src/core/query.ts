/**
 * A port of `src-tauri/src/query.rs`.
 *
 * Values are always bound, never interpolated. Column and direction names come
 * from allow-lists, so a sort key arriving from the interface can pick between
 * columns but can never become SQL. That is the only reason the filters are
 * safe to accept from a renderer at all.
 */

export type Bind = string | number | bigint | Buffer | null;

export class Conditions {
  private readonly clauses: string[] = [];
  private readonly bound: Bind[] = [];

  /** Adds a clause containing one `?` placeholder. */
  add(clause: string, value: Bind): void {
    this.clauses.push(clause);
    this.bound.push(value);
  }

  /** Adds a clause whose placeholders are filled from several values. */
  addMany(clause: string, values: Bind[]): void {
    this.clauses.push(clause);
    this.bound.push(...values);
  }

  /** Adds a clause with no bound values. */
  addRaw(clause: string): void {
    this.clauses.push(clause);
  }

  whereSql(): string {
    return this.clauses.length === 0 ? "" : ` WHERE ${this.clauses.join(" AND ")}`;
  }

  params(): Bind[] {
    return [...this.bound];
  }

  /** The bound values with pagination appended, for the page query. */
  paramsWith(extra: [number, number]): Bind[] {
    return [...this.bound, extra[0], extra[1]];
  }
}

/** Builds `IN (?, ?, ?)` for a list of strings, rejecting anything outside `allowed`. */
export function inClause(
  column: string,
  values: string[],
  allowed: readonly string[],
): { clause: string; params: Bind[] } | null {
  const kept = values.map((value) => value.trim().toLowerCase()).filter((value) => allowed.includes(value));
  if (kept.length === 0) return null;
  const placeholders = kept.map(() => "?").join(", ");
  return { clause: `${column} IN (${placeholders})`, params: kept };
}

/**
 * Resolves a requested sort column against an allow-list.
 *
 * The lookup is an own-property check, not `allowed[requested]`. The Rust original
 * searches a slice of pairs and cannot match anything that was not put there, but
 * a JavaScript object also answers for `constructor`, `toString` and `__proto__`
 * with something from its prototype — and every one of those answers is truthy, so
 * a plain lookup would let a sort key from the interface put a function body where
 * a column name belongs.
 */
export function orderBy(
  requested: string | null | undefined,
  descending: boolean,
  allowed: Record<string, string>,
  fallback: string,
): string {
  const mapped =
    requested && Object.prototype.hasOwnProperty.call(allowed, requested)
      ? allowed[requested]
      : undefined;
  const column = typeof mapped === "string" && mapped !== "" ? mapped : fallback;
  return ` ORDER BY ${column} ${descending ? "DESC" : "ASC"}`;
}

export interface Pagination {
  page: number;
  pageSize: number;
  limit: number;
  offset: number;
}

export function paginate(page?: number | null, pageSize?: number | null): Pagination {
  const size = Math.min(Math.max(Math.trunc(pageSize ?? 50), 1), 500);
  const current = Math.max(Math.trunc(page ?? 1), 1);
  return { page: current, pageSize: size, limit: size, offset: (current - 1) * size };
}

/** Turns free text into a LIKE pattern, escaping the wildcard characters. */
export function likePattern(search: string): string {
  const escaped = search.trim().replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  return `%${escaped}%`;
}
