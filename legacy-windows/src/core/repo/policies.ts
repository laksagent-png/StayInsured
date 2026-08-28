/**
 * A port of `src-tauri/src/repo/policies.rs`.
 *
 * The renewal chain and `syncStatuses` are the two places where a difference
 * between the editions would be visible on the renewal desk rather than in a
 * log, so they are ported statement for statement, including the order the
 * status updates run in. `tests/policies.test.ts` covers the cases that order
 * exists for.
 */

import crypto from "node:crypto";

import type { Conn } from "../db";
import { AppError, describe } from "../errors";
import { Conditions, inClause, likePattern, orderBy, paginate, type Bind } from "../query";
import { blankToNull, numberOrNull, toModel } from "../rows";
import type { Page, Policy, PolicyFilter, PolicyInput, RenewalInput } from "../types";
import {
  CATEGORIES,
  MAX_TERM,
  PLAN_TYPES,
  POLICY_TYPES,
  RIDERS,
  addDays,
  canonicalRiders,
  expiryAfter,
  parseDate,
  splitRiders,
} from "../util";
import * as notifications from "./notifications";
import { count, isConstraintViolation } from "./shared";

export const STATUSES = ["active", "expired", "renewed", "lapsed", "cancelled"] as const;

const SORTABLE: Record<string, string> = {
  expiry: "expiry_date",
  days: "days_to_expiry",
  client: "client_name",
  premium: "premium_amount",
  sumInsured: "sum_insured",
  insurer: "insurer_name",
  category: "category",
  policyNumber: "policy_number",
  created: "created_at",
};

/** Days after expiry with no renewal before a policy is treated as lapsed. */
const LAPSE_GRACE_DAYS = 30;

/**
 * Every column a `Policy` is read from. Exported because the dashboard reads the
 * same view into the same model, and a second copy of this list is a column
 * silently missing from half the app — `POLICY_COLUMNS` is shared in Rust for
 * the same reason.
 */
export const COLUMNS =
  "id, chain_id, policy_year, previous_policy_id, policy_number, " +
  "client_id, client_code, client_name, client_email, client_phone, client_city, " +
  "reminders_opted_out, insurer_id, insurer_name, product_id, product_name, category, status, " +
  "start_date, expiry_date, sum_insured, premium_amount, gst_amount, premium_frequency, " +
  "payment_mode, next_due_date, commission_rate, commission_expected, nominee_name, " +
  "nominee_relation, vehicle_number, variant, riders, plan_type, term, policy_type, broker, " +
  "inbuilt_rider, notes, created_at, updated_at, days_to_expiry, is_renewed";

/**
 * `toModel` copies each column across as it stands, and `riders` is stored as
 * one comma-separated string. Splitting it here is what keeps the two editions
 * handing the screens the same shape, as `Policy::from_row` does in Rust.
 */
export function toPolicy(row: Record<string, unknown>): Policy {
  const policy = toModel<Policy>(row);
  return { ...policy, riders: splitRiders(row.riders) };
}

export function toPolicies(rows: Record<string, unknown>[]): Policy[] {
  return rows.map(toPolicy);
}

function buildConditions(filter: PolicyFilter): Conditions {
  const c = new Conditions();

  const search = filter.search?.trim();
  if (search) {
    const pattern = likePattern(search);
    c.addMany(
      "(policy_number LIKE ? ESCAPE '\\' OR client_name LIKE ? ESCAPE '\\'" +
        " OR client_code LIKE ? ESCAPE '\\' OR vehicle_number LIKE ? ESCAPE '\\')",
      [pattern, pattern, pattern, pattern],
    );
  }

  if (filter.clientId != null) c.add("client_id = ?", filter.clientId);
  if (filter.insurerId != null) c.add("insurer_id = ?", filter.insurerId);
  if (filter.productId != null) c.add("product_id = ?", filter.productId);

  if (filter.categories) {
    const categories = inClause("category", filter.categories, CATEGORIES);
    if (categories) c.addMany(categories.clause, categories.params);
  }
  if (filter.statuses) {
    const statuses = inClause("status", filter.statuses, STATUSES);
    if (statuses) c.addMany(statuses.clause, statuses.params);
  }

  const from = blankToNull(filter.expiryFrom);
  const parsedFrom = from === null ? null : parseDate(from);
  if (parsedFrom) c.add("expiry_date >= ?", parsedFrom);

  const to = blankToNull(filter.expiryTo);
  const parsedTo = to === null ? null : parseDate(to);
  if (parsedTo) c.add("expiry_date <= ?", parsedTo);

  if (filter.expiringWithinDays != null) {
    c.addRaw("days_to_expiry >= 0");
    c.add("days_to_expiry <= ?", filter.expiringWithinDays);
  }
  if (filter.minPremium != null) c.add("IFNULL(premium_amount, 0) >= ?", filter.minPremium);
  if (filter.maxPremium != null) c.add("IFNULL(premium_amount, 0) <= ?", filter.maxPremium);

  const city = blankToNull(filter.city);
  if (city) c.add("client_city = ?", city);

  if (filter.latestOnly) c.addRaw("is_renewed = 0");
  if (filter.unrenewedOnly) c.addRaw("is_renewed = 0 AND status IN ('expired', 'lapsed')");

  return c;
}

export function list(conn: Conn, filter: PolicyFilter): Page<Policy> {
  const conditions = buildConditions(filter);
  const whereSql = conditions.whereSql();

  const total = count(conn, `SELECT COUNT(*) AS n FROM policy_overview${whereSql}`, conditions.params());

  const { page, pageSize, limit, offset } = paginate(filter.page, filter.pageSize);
  const order = orderBy(filter.sort, filter.descending ?? false, SORTABLE, "expiry_date");

  const rows = conn
    .prepare(`SELECT ${COLUMNS} FROM policy_overview${whereSql}${order} LIMIT ? OFFSET ?`)
    .all(...conditions.paramsWith([limit, offset])) as Record<string, unknown>[];

  return { rows: toPolicies(rows), total, page, pageSize };
}

/** Every row matching the filter, ignoring pagination. Used by exports. */
export function listAll(conn: Conn, filter: PolicyFilter): Policy[] {
  const conditions = buildConditions(filter);
  const order = orderBy(filter.sort, filter.descending ?? false, SORTABLE, "expiry_date");
  const rows = conn
    .prepare(`SELECT ${COLUMNS} FROM policy_overview${conditions.whereSql()}${order}`)
    .all(...conditions.params()) as Record<string, unknown>[];
  return toPolicies(rows);
}

export function get(conn: Conn, id: number): Policy {
  const row = conn.prepare(`SELECT ${COLUMNS} FROM policy_overview WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw AppError.notFound("Policy");
  return toPolicy(row);
}

/** The full renewal chain a policy belongs to, oldest year first. */
export function chain(conn: Conn, policyId: number): Policy[] {
  const rows = conn
    .prepare(
      `SELECT ${COLUMNS} FROM policy_overview ` +
        "WHERE chain_id = (SELECT chain_id FROM policies WHERE id = ?) " +
        "ORDER BY policy_year ASC, start_date ASC",
    )
    .all(policyId) as Record<string, unknown>[];
  if (rows.length === 0) throw AppError.notFound("Policy");
  return toPolicies(rows);
}

function validate(input: PolicyInput): { start: string; expiry: string } {
  if (input.policyNumber.trim() === "") throw AppError.validation("Policy number is required");
  if (!(CATEGORIES as readonly string[]).includes(input.category)) {
    throw AppError.validation(`"${input.category}" is not a known policy category`);
  }
  const start = parseDate(input.startDate);
  if (start === null) throw AppError.validation("Start date is not a valid date");
  const expiry = parseDate(input.expiryDate);
  if (expiry === null) throw AppError.validation("Expiry date is not a valid date");
  if (expiry <= start) throw AppError.validation("Expiry date must be after the start date");

  // The health details are checked for being words the app knows, not for being
  // there at all. Requiring them belongs to the add-policy screen: an import
  // carries a book that predates the questions.
  checkWord("plan type", input.planType, PLAN_TYPES);
  checkWord("policy type", input.policyType, POLICY_TYPES);
  for (const rider of input.riders ?? []) checkWord("rider", rider, RIDERS);
  if (input.term != null && (input.term < 1 || input.term > MAX_TERM)) {
    throw AppError.validation(`A term is between 1 and ${MAX_TERM} years`);
  }

  return { start, expiry };
}

/** Holds a value to a fixed vocabulary. Nothing at all is allowed. */
function checkWord(what: string, value: string | null | undefined, allowed: readonly string[]) {
  if (value != null && !allowed.includes(value)) {
    throw AppError.validation(`"${value}" is not a known ${what}`);
  }
}

/** The values create and update share, in the order both statements bind them. */
function fields(input: PolicyInput, start: string, expiry: string): Bind[] {
  const nextDue = blankToNull(input.nextDueDate);
  const vehicle = blankToNull(input.vehicleNumber);
  return [
    input.policyNumber.trim(),
    input.clientId,
    input.insurerId,
    input.productId ?? null,
    input.category,
    start,
    expiry,
    numberOrNull(input.sumInsured),
    numberOrNull(input.premiumAmount),
    numberOrNull(input.gstAmount),
    input.premiumFrequency ?? "annual",
    blankToNull(input.paymentMode),
    nextDue === null ? null : parseDate(nextDue),
    numberOrNull(input.commissionRate),
    numberOrNull(input.commissionExpected),
    blankToNull(input.nomineeName),
    blankToNull(input.nomineeRelation),
    vehicle === null ? null : vehicle.toUpperCase(),
    blankToNull(input.variant),
    canonicalRiders(input.riders),
    blankToNull(input.planType),
    numberOrNull(input.term),
    blankToNull(input.policyType),
    blankToNull(input.broker),
    blankToNull(input.inbuiltRider),
    blankToNull(input.notes),
  ];
}

export function create(conn: Conn, input: PolicyInput): number {
  const { start, expiry } = validate(input);
  const chainId = crypto.randomUUID();

  let id: number;
  try {
    const result = conn
      .prepare(
        // Status is listed last rather than where `policies.rs` puts it, so that the
        // shared field list can be bound straight through and the one value create
        // defaults sits on its own at the end.
        "INSERT INTO policies (chain_id, policy_year, policy_number, client_id, insurer_id, " +
          "product_id, category, start_date, expiry_date, sum_insured, premium_amount, " +
          "gst_amount, premium_frequency, payment_mode, next_due_date, commission_rate, " +
          "commission_expected, nominee_name, nominee_relation, vehicle_number, variant, " +
          "riders, plan_type, term, policy_type, broker, inbuilt_rider, notes, status) " +
          "VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, " +
          "?, ?, ?)",
      )
      .run(chainId, ...fields(input, start, expiry), input.status ?? "active");
    id = Number(result.lastInsertRowid);
  } catch (error) {
    throw mapConstraintError(error);
  }

  setMembers(conn, id, input.insuredClientIds ?? []);
  return id;
}

export function update(conn: Conn, id: number, input: PolicyInput): void {
  const { start, expiry } = validate(input);

  let changes: number;
  try {
    const values = fields(input, start, expiry);
    const result = conn
      .prepare(
        "UPDATE policies SET policy_number = ?, client_id = ?, insurer_id = ?, " +
          "product_id = ?, category = ?, start_date = ?, expiry_date = ?, sum_insured = ?, " +
          "premium_amount = ?, gst_amount = ?, premium_frequency = ?, payment_mode = ?, " +
          "next_due_date = ?, commission_rate = ?, commission_expected = ?, nominee_name = ?, " +
          "nominee_relation = ?, vehicle_number = ?, variant = ?, riders = ?, plan_type = ?, " +
          "term = ?, policy_type = ?, broker = ?, inbuilt_rider = ?, notes = ?, " +
          // Omitting the status leaves the stored one alone, which is what keeps an
          // edit to a lapsed policy from quietly reviving it.
          "status = COALESCE(?, status) WHERE id = ?",
      )
      .run(...values, input.status ?? null, id);
    changes = result.changes;
  } catch (error) {
    throw mapConstraintError(error);
  }

  if (changes === 0) throw AppError.notFound("Policy");
  if (input.insuredClientIds) setMembers(conn, id, input.insuredClientIds);
}

/**
 * Adds the next year to a chain. Values not supplied are carried forward from the
 * policy being renewed, and the previous year is marked as renewed rather than
 * overwritten.
 */
export function renew(conn: Conn, input: RenewalInput): number {
  const previous = get(conn, input.policyId);

  // One open year to a chain. A second successor would leave the chain forking
  // with two open years and the desk showing both.
  if (previous.isRenewed) {
    throw AppError.conflict("That year has already been renewed. Renew the latest year instead.");
  }

  const requestedStart = blankToNull(input.startDate);
  const start =
    (requestedStart === null ? null : parseDate(requestedStart)) ?? addDays(previous.expiryDate, 1);
  if (start === null) throw AppError.other("stored expiry date is unreadable");

  const requestedExpiry = blankToNull(input.expiryDate);
  // A three-year policy renews for three years unless the agent says otherwise,
  // so the term that was bought decides the length rather than the annual
  // default.
  const expiry =
    (requestedExpiry === null ? null : parseDate(requestedExpiry)) ??
    expiryAfter(start, previous.term ?? 1);
  if (expiry === null) throw AppError.other("could not work out the new expiry date");

  if (expiry <= start) throw AppError.validation("Expiry date must be after the start date");

  const policyNumber = blankToNull(input.policyNumber) ?? previous.policyNumber;

  let newId: number;
  try {
    const result = conn
      .prepare(
        "INSERT INTO policies (chain_id, policy_year, previous_policy_id, policy_number, client_id, " +
          "insurer_id, product_id, category, status, start_date, expiry_date, sum_insured, " +
          "premium_amount, gst_amount, premium_frequency, payment_mode, commission_rate, " +
          "commission_expected, nominee_name, nominee_relation, vehicle_number, variant, " +
          "riders, plan_type, term, policy_type, broker, inbuilt_rider, notes) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, " +
          "?, ?, ?, ?, ?, ?)",
      )
      .run(
        previous.chainId,
        previous.policyYear + 1,
        previous.id,
        policyNumber,
        previous.clientId,
        previous.insurerId,
        previous.productId,
        previous.category,
        start,
        expiry,
        input.sumInsured ?? previous.sumInsured,
        input.premiumAmount ?? previous.premiumAmount,
        input.gstAmount ?? previous.gstAmount,
        previous.premiumFrequency,
        previous.paymentMode,
        input.commissionRate ?? previous.commissionRate,
        input.commissionExpected ?? previous.commissionExpected,
        previous.nomineeName,
        previous.nomineeRelation,
        previous.vehicleNumber,
        previous.variant,
        canonicalRiders(previous.riders),
        previous.planType,
        previous.term,
        // The new year is a renewal by definition, whatever the year before it
        // was. A policy ported in last August is a renewal this August.
        previous.policyType === null ? null : "renewal",
        previous.broker,
        previous.inbuiltRider,
        blankToNull(input.notes),
      );
    newId = Number(result.lastInsertRowid);
  } catch (error) {
    throw mapConstraintError(error);
  }

  conn
    .prepare(
      "INSERT INTO policy_members (policy_id, insured_client_id) " +
        "SELECT ?, insured_client_id FROM policy_members WHERE policy_id = ?",
    )
    .run(newId, previous.id);

  // A cancelled year keeps saying so. Cancelling is something the agent did and
  // the client agreed to; writing 'renewed' over it would leave the book unable
  // to say the cover was ever ended early. The year is still marked renewed for
  // every purpose that matters, because `is_renewed` reads the successor rather
  // than the status.
  conn.prepare("UPDATE policies SET status = 'renewed' WHERE id = ? AND status <> 'cancelled'").run(previous.id);

  // A client who has just renewed should not receive this morning's queued
  // "your policy is about to expire" message this evening.
  notifications.cancelForPolicy(conn, previous.id);

  return newId;
}

export function remove(conn: Conn, id: number): void {
  const result = conn.prepare("DELETE FROM policies WHERE id = ?").run(id);
  if (result.changes === 0) throw AppError.notFound("Policy");
}

export function setStatus(conn: Conn, id: number, status: string): void {
  if (!(STATUSES as readonly string[]).includes(status)) {
    throw AppError.validation(`"${status}" is not a valid status`);
  }
  const result = conn.prepare("UPDATE policies SET status = ? WHERE id = ?").run(status, id);
  if (result.changes === 0) throw AppError.notFound("Policy");
}

/**
 * Replaces the list of clients a policy year covers.
 *
 * A client may be attached when they are the policyholder or when the book
 * records how they are related to them. The rule lives in the insert rather than
 * in the interface: a floater is the one place where a stray id would put a
 * stranger's name and date of birth onto somebody else's cover, and an import
 * reaches this code without passing a screen at all.
 */
export function setMembers(conn: Conn, policyId: number, insuredClientIds: number[]): void {
  conn.prepare("DELETE FROM policy_members WHERE policy_id = ?").run(policyId);
  const insert = conn.prepare(
    "INSERT OR IGNORE INTO policy_members (policy_id, insured_client_id) " +
      "SELECT ?, c.id FROM clients c WHERE c.id = ? AND ( " +
      "     c.id = (SELECT client_id FROM policies WHERE id = ?) " +
      "  OR EXISTS (SELECT 1 FROM client_relations r " +
      "              WHERE (r.client_id = (SELECT client_id FROM policies WHERE id = ?) " +
      "                     AND r.related_client_id = c.id) " +
      "                 OR (r.related_client_id = (SELECT client_id FROM policies WHERE id = ?) " +
      "                     AND r.client_id = c.id)))",
  );
  for (const clientId of insuredClientIds) {
    insert.run(policyId, clientId, policyId, policyId, policyId);
  }
}

/** The clients a policy year covers. */
export function insuredOf(conn: Conn, policyId: number): number[] {
  const rows = conn
    .prepare(
      "SELECT insured_client_id AS id FROM policy_members WHERE policy_id = ? " +
        "ORDER BY insured_client_id",
    )
    .all(policyId) as { id: number }[];
  return rows.map((row) => row.id);
}

/**
 * Brings statuses in line with the calendar. Runs on unlock and before every
 * reminder sweep so that "expiring" and "lapsed" always mean what they say.
 *
 * The order matters: a successor decides renewal before the calendar decides
 * anything, and the last statement is the correction path for an edited expiry.
 */
export function syncStatuses(conn: Conn): number {
  const statements = [
    // A policy with a successor is renewed, whatever it said before.
    "UPDATE policies SET status = 'renewed' " +
      "WHERE status IN ('active', 'expired', 'lapsed') " +
      "  AND EXISTS (SELECT 1 FROM policies s WHERE s.previous_policy_id = policies.id)",

    // And one without a successor is not, however it came to say so: deleting the
    // year that replaced it puts it back at the head of its chain.
    "UPDATE policies SET status = 'active' " +
      "WHERE status = 'renewed' " +
      "  AND NOT EXISTS (SELECT 1 FROM policies s WHERE s.previous_policy_id = policies.id)",

    "UPDATE policies SET status = 'expired' " +
      "WHERE status = 'active' AND expiry_date < date('now', 'localtime') " +
      "  AND NOT EXISTS (SELECT 1 FROM policies s WHERE s.previous_policy_id = policies.id)",

    "UPDATE policies SET status = 'lapsed' " +
      "WHERE status = 'expired' " +
      `  AND julianday(date('now', 'localtime')) - julianday(expiry_date) > ${LAPSE_GRACE_DAYS} ` +
      "  AND NOT EXISTS (SELECT 1 FROM policies s WHERE s.previous_policy_id = policies.id)",

    // Correction path: a back-dated expiry edit can make an expired policy current again.
    "UPDATE policies SET status = 'active' " +
      "WHERE status IN ('expired', 'lapsed') AND expiry_date >= date('now', 'localtime') " +
      "  AND NOT EXISTS (SELECT 1 FROM policies s WHERE s.previous_policy_id = policies.id)",
  ];

  let touched = 0;
  for (const sql of statements) touched += conn.prepare(sql).run().changes;
  return touched;
}

function mapConstraintError(error: unknown): AppError {
  if (!isConstraintViolation(error)) return AppError.database(error);
  const message = describe(error);
  if (message.includes("policies.policy_number") || message.includes("insurer_id, policy_number")) {
    return AppError.conflict(
      "That policy number already exists for this insurer. Use Renew to add the next year.",
    );
  }
  if (message.includes("FOREIGN KEY")) {
    return AppError.validation("Pick an existing client and insurer for this policy");
  }
  return AppError.conflict(message);
}
