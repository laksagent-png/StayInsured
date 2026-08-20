/** A port of `src-tauri/src/repo/dashboard.rs`. */

import type { Conn } from "../db";
import { toModels } from "../rows";
import type { CategoryBreakdown, Dashboard, ExpiryBucket, Policy } from "../types";
import { IS_DEPENDENT } from "./clients";

/** Windows the renewal desk works in, in days from today. */
const BUCKETS: [label: string, from: number, to: number][] = [
  ["Overdue", -3_650, -1],
  ["0-7 days", 0, 7],
  ["8-15 days", 8, 15],
  ["16-30 days", 16, 30],
  ["31-60 days", 31, 60],
  ["61-90 days", 61, 90],
];

const COLUMNS =
  "id, chain_id, policy_year, previous_policy_id, policy_number, " +
  "client_id, client_code, client_name, client_email, client_phone, client_city, " +
  "reminders_opted_out, insurer_id, insurer_name, product_id, product_name, category, status, " +
  "start_date, expiry_date, sum_insured, premium_amount, gst_amount, premium_frequency, " +
  "payment_mode, next_due_date, commission_rate, commission_expected, nominee_name, " +
  "nominee_relation, vehicle_number, notes, created_at, updated_at, days_to_expiry, is_renewed";

export function load(conn: Conn): Dashboard {
  const scalar = (sql: string): number => {
    const row = conn.prepare(sql).get() as Record<string, number>;
    return Object.values(row)[0] ?? 0;
  };

  const buckets: ExpiryBucket[] = BUCKETS.map(([label, from, to]) => {
    // Everything past expiry only counts while it is still unrenewed.
    const extra = to < 0 ? " AND is_renewed = 0 AND status <> 'cancelled'" : " AND status = 'active'";
    const row = conn
      .prepare(
        "SELECT COUNT(*) AS count, IFNULL(SUM(premium_amount), 0) AS premium FROM policy_overview " +
          `WHERE days_to_expiry BETWEEN ? AND ?${extra}`,
      )
      .get(from, to) as { count: number; premium: number };
    return { label, count: row.count, premiumTotal: row.premium };
  });

  const byCategory = conn
    .prepare(
      "SELECT category, COUNT(*) AS policy_count, IFNULL(SUM(premium_amount), 0) AS premium_total, " +
        "IFNULL(SUM(sum_insured), 0) AS sum_insured_total " +
        "FROM policy_overview WHERE status = 'active' GROUP BY category ORDER BY COUNT(*) DESC",
    )
    .all() as Record<string, unknown>[];

  const policies = (tail: string): Policy[] =>
    toModels<Policy>(conn.prepare(`SELECT ${COLUMNS} FROM policy_overview ${tail}`).all() as Record<
      string,
      unknown
    >[]);

  // The counts of people are counts of policyholders. A family member is a client,
  // so counting rows would say the book holds half again as many people as it has
  // cover for, and would report every child as a client with no email address —
  // which is the one figure on this screen meant to be acted on.
  const holders = `FROM clients c WHERE NOT (${IS_DEPENDENT})`;

  return {
    totalClients: scalar(`SELECT COUNT(*) AS n ${holders}`),
    activeClients: scalar(`SELECT COUNT(*) AS n ${holders} AND c.is_archived = 0`),
    activePolicies: scalar("SELECT COUNT(*) AS n FROM policies WHERE status = 'active'"),
    expiringThisWeek: scalar(
      "SELECT COUNT(*) AS n FROM policy_overview WHERE status = 'active' AND days_to_expiry BETWEEN 0 AND 7",
    ),
    expiringThisMonth: scalar(
      "SELECT COUNT(*) AS n FROM policy_overview WHERE status = 'active' AND days_to_expiry BETWEEN 0 AND 30",
    ),
    expiredUnrenewed: scalar(
      "SELECT COUNT(*) AS n FROM policy_overview WHERE is_renewed = 0 AND status IN ('expired', 'lapsed')",
    ),
    premiumUnderManagement: scalar(
      "SELECT IFNULL(SUM(premium_amount), 0) AS n FROM policies WHERE status = 'active'",
    ),
    commissionExpected: scalar(
      "SELECT IFNULL(SUM(commission_expected), 0) AS n FROM policies WHERE status = 'active'",
    ),
    clientsWithoutEmail: scalar(
      `SELECT COUNT(*) AS n ${holders} AND c.is_archived = 0 AND (c.email IS NULL OR c.email = '')`,
    ),
    buckets,
    byCategory: toModels<CategoryBreakdown>(byCategory),
    upcoming: policies(
      "WHERE status = 'active' AND days_to_expiry BETWEEN 0 AND 45 ORDER BY expiry_date ASC LIMIT 12",
    ),
    recentlyLapsed: policies(
      "WHERE is_renewed = 0 AND status IN ('expired', 'lapsed') ORDER BY expiry_date DESC LIMIT 8",
    ),
  };
}
