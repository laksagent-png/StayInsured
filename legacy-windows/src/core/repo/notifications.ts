/**
 * A port of `src-tauri/src/repo/notifications.rs`: the outbox.
 *
 * A row is written before anything is sent. `UNIQUE (rule_id, policy_id,
 * policy_period)` is what makes a reminder fire exactly once per policy year,
 * however many times the sweep runs or the app restarts, and it is why a crash
 * mid-send costs at most one duplicate rather than a mailshot.
 */

import type { Conn } from "../db";
import { AppError } from "../errors";
import { Conditions, inClause, likePattern, orderBy, paginate } from "../query";
import { toModel, toModels } from "../rows";
import type { Notification, NotificationFilter, Page } from "../types";
import { count } from "./shared";

export const STATUSES = ["queued", "sent", "failed", "skipped", "cancelled"] as const;

const SORTABLE: Record<string, string> = {
  scheduledFor: "n.scheduled_for",
  createdAt: "n.created_at",
  sentAt: "n.sent_at",
  status: "n.status",
  clientName: "client_name",
};

const COLUMNS =
  "n.id, n.rule_id, " +
  "(SELECT r.name FROM reminder_rules r WHERE r.id = n.rule_id) AS rule_name, " +
  "n.policy_id, (SELECT p.policy_number FROM policies p WHERE p.id = n.policy_id) AS policy_number, " +
  "n.client_id, (SELECT c.full_name FROM clients c WHERE c.id = n.client_id) AS client_name, " +
  "n.policy_period, n.audience, n.channel, n.to_address, n.subject, n.status, n.attempts, " +
  "n.last_error, n.scheduled_for, n.sent_at, n.created_at";

/** What goes into the outbox before sending. */
export interface NewNotification {
  ruleId: number;
  policyId: number;
  clientId: number;
  policyPeriod: string;
  audience: string;
  channel: string;
  toAddress: string | null;
  subject: string;
  body: string;
  scheduledFor: string;
}

/**
 * The message itself, fetched only when a row is about to be sent — the snapshots
 * are large and no list needs them.
 */
export interface Payload {
  id: number;
  channel: string;
  toAddress: string | null;
  clientName: string;
  subject: string;
  body: string;
}

/**
 * Returns the new row id, or null when this reminder already exists for this
 * policy year and nothing was written.
 */
export function queue(conn: Conn, entry: NewNotification): number | null {
  const result = conn
    .prepare(
      "INSERT OR IGNORE INTO notification_log (rule_id, policy_id, client_id, policy_period, " +
        "audience, channel, to_address, subject, body_snapshot, status, scheduled_for) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)",
    )
    .run(
      entry.ruleId,
      entry.policyId,
      entry.clientId,
      entry.policyPeriod,
      entry.audience,
      entry.channel,
      entry.toAddress,
      entry.subject,
      entry.body,
      entry.scheduledFor,
    );
  return result.changes === 0 ? null : Number(result.lastInsertRowid);
}

/**
 * Whether this rule has already been recorded against this policy year, in any
 * state. Used by the planner so a preview does not offer what will be ignored.
 */
export function alreadyLogged(conn: Conn, ruleId: number, policyId: number, period: string): boolean {
  const row = conn
    .prepare(
      "SELECT COUNT(*) AS n FROM notification_log " +
        "WHERE rule_id = ? AND policy_id = ? AND policy_period = ?",
    )
    .get(ruleId, policyId, period) as { n: number };
  return row.n > 0;
}

/** Queued rows whose time has come, oldest first so a backlog drains in order. */
export function due(conn: Conn, nowIso: string, limit: number): Payload[] {
  const rows = conn
    .prepare(
      "SELECT n.id, n.channel, n.to_address, " +
        "COALESCE((SELECT c.full_name FROM clients c WHERE c.id = n.client_id), '') AS client_name, " +
        "COALESCE(n.subject, '') AS subject, COALESCE(n.body_snapshot, '') AS body " +
        "FROM notification_log n " +
        "WHERE n.status = 'queued' AND n.scheduled_for <= ? " +
        "ORDER BY n.scheduled_for, n.id LIMIT ?",
    )
    .all(nowIso, limit) as Record<string, unknown>[];
  return rows.map((row) => toModel<Payload>(row));
}

export function markSent(conn: Conn, id: number): void {
  conn
    .prepare(
      "UPDATE notification_log SET status = 'sent', attempts = attempts + 1, " +
        "last_error = NULL, sent_at = datetime('now') WHERE id = ?",
    )
    .run(id);
}

/**
 * Stays `queued` for the first few attempts so the next sweep picks it up; a
 * server that is down for an hour should not need the operator to intervene.
 */
export function markAttemptFailed(conn: Conn, id: number, error: string, maxAttempts: number): void {
  conn
    .prepare(
      "UPDATE notification_log " +
        "SET attempts = attempts + 1, last_error = ?, " +
        "    status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'queued' END " +
        "WHERE id = ?",
    )
    .run(error, maxAttempts, id);
}

export function markSkipped(conn: Conn, id: number, reason: string): void {
  conn.prepare("UPDATE notification_log SET status = 'skipped', last_error = ? WHERE id = ?").run(reason, id);
}

/** Puts a failed or cancelled row back in the queue for the next sweep. */
export function requeue(conn: Conn, id: number): void {
  const result = conn
    .prepare(
      "UPDATE notification_log SET status = 'queued', attempts = 0, last_error = NULL, " +
        "scheduled_for = datetime('now') WHERE id = ? AND status IN ('failed', 'cancelled', 'skipped')",
    )
    .run(id);
  if (result.changes === 0) {
    throw AppError.conflict("Only a failed, skipped or cancelled reminder can be sent again");
  }
}

export function cancel(conn: Conn, id: number): void {
  const result = conn
    .prepare("UPDATE notification_log SET status = 'cancelled' WHERE id = ? AND status = 'queued'")
    .run(id);
  if (result.changes === 0) throw AppError.conflict("Only a queued reminder can be cancelled");
}

export function list(conn: Conn, filter: NotificationFilter): Page<Notification> {
  const conditions = new Conditions();

  if (filter.statuses) {
    const statuses = inClause("n.status", filter.statuses, STATUSES);
    if (statuses) conditions.addMany(statuses.clause, statuses.params);
  }
  if (filter.clientId != null) conditions.add("n.client_id = ?", filter.clientId);
  if (filter.policyId != null) conditions.add("n.policy_id = ?", filter.policyId);

  const search = filter.search?.trim();
  if (search) {
    const pattern = likePattern(search);
    conditions.addMany(
      "(n.to_address LIKE ? ESCAPE '\\' OR n.subject LIKE ? ESCAPE '\\'" +
        " OR EXISTS (SELECT 1 FROM clients c WHERE c.id = n.client_id" +
        "            AND c.full_name LIKE ? ESCAPE '\\'))",
      [pattern, pattern, pattern],
    );
  }

  const whereSql = conditions.whereSql();
  const total = count(
    conn,
    `SELECT COUNT(*) AS n FROM notification_log n${whereSql}`,
    conditions.params(),
  );

  const { page, pageSize, limit, offset } = paginate(filter.page, filter.pageSize);
  // Newest first unless asked otherwise: the outbox is read to find out what just
  // happened far more often than what happened first.
  const order = orderBy(filter.sort, filter.descending ?? true, SORTABLE, "n.scheduled_for");

  const rows = conn
    .prepare(`SELECT ${COLUMNS} FROM notification_log n${whereSql}${order} LIMIT ? OFFSET ?`)
    .all(...conditions.paramsWith([limit, offset])) as Record<string, unknown>[];

  return { rows: toModels<Notification>(rows), total, page, pageSize };
}

export function countByStatus(conn: Conn, status: string): number {
  const row = conn
    .prepare("SELECT COUNT(*) AS n FROM notification_log WHERE status = ?")
    .get(status) as { n: number };
  return row.n;
}

export function sentOn(conn: Conn, dayIso: string): number {
  const row = conn
    .prepare("SELECT COUNT(*) AS n FROM notification_log WHERE status = 'sent' AND date(sent_at) = ?")
    .get(dayIso) as { n: number };
  return row.n;
}

/**
 * Clears rows for a policy year that has since been renewed, so a reminder queued
 * yesterday does not chase a client who has already renewed.
 */
export function cancelForPolicy(conn: Conn, policyId: number): number {
  const result = conn
    .prepare(
      "UPDATE notification_log SET status = 'cancelled', " +
        "last_error = 'The policy was renewed' " +
        "WHERE policy_id = ? AND status = 'queued'",
    )
    .run(policyId);
  return result.changes;
}
