/**
 * A port of `src-tauri/src/reminders.rs`: working out which reminders are due,
 * queueing them, and sending them.
 *
 * The sweep is deliberately split in two. Planning decides what should go out and
 * writes it to the outbox; dispatch takes what is in the outbox and tries to
 * deliver it. Keeping them apart is what lets a send fail — a laptop lid closing
 * mid-run, a mail server having a bad morning — without losing the reminder or
 * sending it twice.
 *
 * The four context builders live in `templating.ts` rather than here, unlike the
 * Rust core, because `preview_template` needed them before the sweep existed.
 */

import type { Conn } from "./db";
import type { CoreEnv, SecretStore } from "./env";
import { AppError, describe } from "./errors";
import * as mail from "./mail";
import type { Outgoing } from "./mail";
import * as notifications from "./repo/notifications";
import * as rules from "./repo/rules";
import * as settings from "./repo/settings";
import * as templates from "./repo/templates";
import { Context, escapeHtml, policyContext, providerContext, render } from "./templating";
import type { PlannedReminder, ReminderOverview, ReminderRun } from "./types";
import {
  addDays,
  categoryLabel,
  formatDate,
  formatMoney,
  looksLikeEmail,
  todayIso,
} from "./util";

/**
 * Attempts before a queued reminder is parked as failed for the operator to look
 * at. Three sweeps is enough to ride out a server having a bad morning.
 */
const MAX_ATTEMPTS = 3;

/**
 * Delivers a message. Implemented by the SMTP mailer, and by a recording fake in
 * the tests so the engine can be exercised without a mail server.
 */
export interface Sender {
  deliver(message: Outgoing): Promise<void>;
}

/**
 * Raises a desktop notification. The engine does not depend on Electron, so the
 * command layer passes one of these in.
 */
export interface Alerter {
  alert(title: string, body: string): void;
}

/** The desktop notifications of `alerts.rs`, as the machine supplies them. */
export function alerts(env: CoreEnv): Alerter {
  return { alert: (title, body) => env.notify(title, body) };
}

export interface SweepOptions {
  today: string;
  /** Work out and record what would go out, but send nothing. */
  dryRun: boolean;
}

export function liveOptions(): SweepOptions {
  return { today: todayIso(), dryRun: false };
}

/**
 * One policy that a rule matches today, with everything needed to write it to the
 * outbox.
 */
interface Match {
  ruleId: number;
  ruleName: string;
  channel: string;
  templateId: number | null;
  policyId: number;
  policyNumber: string;
  clientId: number;
  clientName: string;
  clientEmail: string | null;
  expiryDate: string;
  daysToExpiry: number;
  blocked: string | null;
}

/** What the sweep would do today, without writing anything. */
export function plan(conn: Conn, today: string): PlannedReminder[] {
  const provider = providerContext(conn);
  const planned: PlannedReminder[] = [];

  for (const candidate of candidates(conn, today)) {
    const subject =
      candidate.templateId === null
        ? candidate.ruleName
        : render(
            templates.get(conn, candidate.templateId).subject,
            policyContext(conn, candidate.policyId, provider),
          );

    planned.push({
      ruleId: candidate.ruleId,
      ruleName: candidate.ruleName,
      policyId: candidate.policyId,
      policyNumber: candidate.policyNumber,
      clientId: candidate.clientId,
      clientName: candidate.clientName,
      toAddress: candidate.clientEmail,
      expiryDate: candidate.expiryDate,
      daysToExpiry: candidate.daysToExpiry,
      channel: candidate.channel,
      subject,
      blockedReason: candidate.blocked,
    });
  }

  return planned;
}

/**
 * Plans, queues and sends in one pass. Returns what happened.
 *
 * `sweep` in the Rust core runs inside one transaction. Sending here has to be
 * awaited and a better-sqlite3 transaction cannot span an await, so the pass that
 * decides and queues keeps the transaction and each delivery commits its own
 * result. A run cut short therefore leaves what it has already sent marked sent,
 * rather than rolling those marks back and writing to the same clients again.
 */
export async function sweep(
  conn: Conn,
  sender: Sender | null,
  alerter: Alerter,
  options: SweepOptions,
): Promise<ReminderRun> {
  const run: ReminderRun = {
    dryRun: options.dryRun,
    queued: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    heldByCap: 0,
    desktopAlerts: 0,
    digestSent: false,
    issues: [],
  };

  conn.transaction(() => queueWhatIsDue(conn, alerter, options, run))();

  if (!options.dryRun) {
    await dispatch(conn, sender, options, run);
    run.digestSent = await sendDigest(conn, sender, alerter, options, run);
    settings.put(conn, "last_sweep_at", localStamp(new Date()));
  }

  return run;
}

function queueWhatIsDue(conn: Conn, alerter: Alerter, options: SweepOptions, run: ReminderRun): void {
  const provider = providerContext(conn);

  for (const candidate of candidates(conn, options.today)) {
    // A blocked reminder is still recorded, once, so the operator can see why
    // nothing was sent and the same client is not raised every day.
    if (candidate.blocked !== null) {
      run.skipped += 1;
      if (!options.dryRun) recordSkip(conn, candidate, candidate.blocked);
      continue;
    }

    if (candidate.templateId === null) {
      run.skipped += 1;
      run.issues.push(
        `${candidate.ruleName} has no message to send, so ${candidate.clientName} was not written to.`,
      );
      continue;
    }

    const template = templates.get(conn, candidate.templateId);
    const context = policyContext(conn, candidate.policyId, provider);
    const subject = render(template.subject, context);
    const body = render(template.bodyHtml, context);

    if (options.dryRun) {
      run.queued += 1;
      continue;
    }

    const written = notifications.queue(conn, {
      ruleId: candidate.ruleId,
      policyId: candidate.policyId,
      clientId: candidate.clientId,
      policyPeriod: candidate.expiryDate,
      audience: "client",
      channel: candidate.channel,
      toAddress: candidate.clientEmail,
      subject,
      body,
      scheduledFor: options.today,
    });
    if (written !== null) run.queued += 1;

    if (candidate.channel !== "email") {
      alerter.alert(
        `${candidate.clientName} expires soon`,
        `${candidate.policyNumber} · ${formatDate(candidate.expiryDate, provider.dateFormat)} · ` +
          `${candidate.daysToExpiry} days`,
      );
      run.desktopAlerts += 1;
    }
  }
}

/** Sends what is sitting in the outbox, newest failures included, up to the daily cap. */
async function dispatch(
  conn: Conn,
  sender: Sender | null,
  options: SweepOptions,
  run: ReminderRun,
): Promise<void> {
  const cap = Math.max(settings.getInt(conn, "daily_send_cap", 400), 0);
  const alreadySent = notifications.sentOn(conn, options.today);
  const allowance = Math.max(cap - alreadySent, 0);

  const waiting = notifications.due(conn, `${options.today} 23:59:59`, 5_000);
  const totalWaiting = waiting.length;

  if (sender === null) {
    run.issues.push("No mail server is set up, so nothing was sent.");
    return;
  }

  for (const payload of waiting.slice(0, allowance)) {
    // Desktop-only rows have already been shown; nothing is emailed.
    if (payload.channel === "desktop") {
      notifications.markSent(conn, payload.id);
      run.sent += 1;
      continue;
    }

    const address =
      payload.toAddress !== null && payload.toAddress.trim() !== "" ? payload.toAddress : null;
    if (address === null) {
      notifications.markSkipped(conn, payload.id, "No email address");
      run.skipped += 1;
      continue;
    }

    try {
      await sender.deliver({
        toName: payload.clientName,
        toEmail: address,
        subject: payload.subject,
        html: payload.body,
      });
      notifications.markSent(conn, payload.id);
      run.sent += 1;
    } catch (error) {
      const message = describe(error);
      notifications.markAttemptFailed(conn, payload.id, message, MAX_ATTEMPTS);
      run.failed += 1;
      if (run.issues.length < 20) run.issues.push(`${payload.clientName}: ${message}`);
    }
  }

  if (totalWaiting > allowance) {
    run.heldByCap = totalWaiting - allowance;
    run.issues.push(
      `${run.heldByCap} reminders are waiting for tomorrow: today's cap of ${cap} was reached.`,
    );
  }
}

interface DigestRow {
  client_name: string;
  policy_number: string;
  insurer_name: string;
  category: string;
  expiry_date: string;
  premium_amount: number;
}

/** One message to the agency summarising the day, rather than one per policy. */
async function sendDigest(
  conn: Conn,
  sender: Sender | null,
  alerter: Alerter,
  options: SweepOptions,
  run: ReminderRun,
): Promise<boolean> {
  if (settings.getOr(conn, "digest_enabled", "true") !== "true") return false;

  const day = options.today;
  const window = Math.min(Math.max(settings.getInt(conn, "expiring_soon_window", 30), 1), 365);
  const horizon = dayAfter(day, window);

  const rows = conn
    .prepare(
      "SELECT client_name, policy_number, insurer_name, category, expiry_date, " +
        "COALESCE(premium_amount, 0) AS premium_amount " +
        "FROM policy_overview " +
        "WHERE status = 'active' AND expiry_date <= ? " +
        "ORDER BY expiry_date LIMIT 100",
    )
    .all(horizon) as DigestRow[];

  if (rows.length === 0) return false;

  const provider = providerContext(conn);
  if (settings.getOr(conn, "desktop_alerts", "true") === "true") {
    alerter.alert("StayInsured", `${rows.length} policies expire within ${window} days.`);
    run.desktopAlerts += 1;
  }

  const to = settings.getOr(conn, "provider_email", "");
  if (to.trim() === "" || sender === null) return false;
  if (digestAlreadySent(conn, day)) return false;

  const template = templates.activeForTrigger(conn, "provider_digest");
  if (template === null) return false;

  const table =
    '<table cellpadding="6" style="border-collapse:collapse;font-size:14px">' +
    '<tr style="text-align:left;color:#6b7280"><th>Client</th><th>Policy</th>' +
    "<th>Insurer</th><th>Type</th><th>Expires</th><th>Premium</th></tr>" +
    rows
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.client_name)}</td><td>${escapeHtml(row.policy_number)}</td>` +
          `<td>${escapeHtml(row.insurer_name)}</td><td>${categoryLabel(row.category)}</td>` +
          `<td>${formatDate(row.expiry_date, provider.dateFormat)}</td>` +
          `<td>${formatMoney(row.premium_amount, provider.currency)}</td></tr>`,
      )
      .join("") +
    "</table>";

  const context = new Context();
  context
    .set("provider_name", provider.name)
    .set("provider_email", provider.email)
    .set("provider_phone", provider.phone)
    .set("today", formatDate(day, provider.dateFormat))
    .set("expiring_count", `${rows.length}`)
    .set("digest_table", table);

  const subject = render(template.subject, context);
  const body = render(template.bodyHtml, context);

  let sent = true;
  try {
    await sender.deliver({
      toName: provider.name,
      toEmail: to,
      subject,
      html: body,
    });
  } catch {
    // The digest is a courtesy to the agency rather than something a client is
    // waiting for, so a failure is recorded and the sweep still reports its own
    // figures.
    sent = false;
  }

  conn
    .prepare(
      "INSERT INTO notification_log (rule_id, policy_id, client_id, policy_period, audience, " +
        "channel, to_address, subject, body_snapshot, status, scheduled_for, sent_at) " +
        "VALUES (NULL, NULL, NULL, ?, 'provider', 'email', ?, ?, ?, ?, ?, " +
        "CASE WHEN ? THEN datetime('now') END)",
    )
    .run(day, to, subject, body, sent ? "sent" : "failed", day, sent ? 1 : 0);

  return sent;
}

function digestAlreadySent(conn: Conn, day: string): boolean {
  const row = conn
    .prepare(
      "SELECT COUNT(*) AS n FROM notification_log " +
        "WHERE audience = 'provider' AND policy_period = ? AND status IN ('sent', 'queued')",
    )
    .get(day) as { n: number };
  return row.n > 0;
}

interface CandidateRow {
  id: number;
  policy_number: string;
  client_id: number;
  expiry_date: string;
  full_name: string;
  email: string | null;
  reminders_opted_out: number;
}

/** Every policy that an active rule matches today. */
function candidates(conn: Conn, today: string): Match[] {
  const found: Match[] = [];

  for (const rule of rules.active(conn)) {
    if (rule.audience !== "client") continue;

    // The rule fires when expiry is exactly its offset away: 30 days before
    // expiry means expiry is 30 days from today.
    const target = dayAfter(today, rule.offsetDays);

    // After expiry, only policies nobody has renewed are worth chasing.
    const statusClause =
      rule.offsetDays < 0 ? "p.status IN ('expired', 'lapsed')" : "p.status = 'active'";
    const categoryClause = rule.category === null ? "" : "AND p.category = ?";

    const rows = conn
      .prepare(
        "SELECT p.id, p.policy_number, p.client_id, p.expiry_date, c.full_name, c.email, " +
          "c.reminders_opted_out " +
          "FROM policies p JOIN clients c ON c.id = p.client_id " +
          "WHERE p.expiry_date = ? AND " +
          statusClause +
          " AND c.is_archived = 0 " +
          "AND NOT EXISTS (SELECT 1 FROM policies later " +
          "                WHERE later.previous_policy_id = p.id) " +
          categoryClause +
          " ORDER BY c.full_name",
      )
      .all(...(rule.category === null ? [target] : [target, rule.category])) as CandidateRow[];

    for (const row of rows) {
      if (notifications.alreadyLogged(conn, rule.id, row.id, row.expiry_date)) continue;

      found.push({
        ruleId: rule.id,
        ruleName: rule.name,
        channel: rule.channel,
        templateId: rule.templateId,
        policyId: row.id,
        policyNumber: row.policy_number,
        clientId: row.client_id,
        clientName: row.full_name,
        clientEmail: row.email,
        expiryDate: row.expiry_date,
        daysToExpiry: rule.offsetDays,
        blocked: whyBlocked(row),
      });
    }
  }

  return found;
}

function whyBlocked(row: CandidateRow): string | null {
  if (row.reminders_opted_out !== 0) return "The client has opted out of reminders";
  const email = row.email ?? "";
  if (email.trim() === "") return "No email address on the client";
  if (!looksLikeEmail(email)) return "The email address does not look valid";
  return null;
}

function recordSkip(conn: Conn, candidate: Match, reason: string): void {
  const id = notifications.queue(conn, {
    ruleId: candidate.ruleId,
    policyId: candidate.policyId,
    clientId: candidate.clientId,
    policyPeriod: candidate.expiryDate,
    audience: "client",
    channel: candidate.channel,
    toAddress: candidate.clientEmail,
    subject: candidate.ruleName,
    body: "",
    scheduledFor: candidate.expiryDate,
  });
  if (id !== null) notifications.markSkipped(conn, id, reason);
}

export function overview(conn: Conn, secrets: SecretStore): ReminderOverview {
  const smtp = mail.load(conn, secrets);
  const today = todayIso();
  const due = plan(conn, today);

  const scalar = (sql: string, ...params: unknown[]) =>
    (conn.prepare(sql).get(...(params as never[])) as { n: number }).n;

  const window = Math.min(Math.max(settings.getInt(conn, "expiring_soon_window", 30), 1), 365);

  return {
    enabled: settings.getOr(conn, "reminders_enabled", "false") === "true",
    dryRun: settings.getOr(conn, "dry_run", "true") === "true",
    smtpConfigured: mail.isUsable(smtp),
    smtpPasswordSet: smtp.password !== "",
    fromEmail: smtp.fromEmail,
    sendTime: settings.getOr(conn, "reminder_send_time", "09:00"),
    dailyCap: settings.getInt(conn, "daily_send_cap", 400),
    digestEnabled: settings.getOr(conn, "digest_enabled", "true") === "true",
    desktopAlerts: settings.getOr(conn, "desktop_alerts", "true") === "true",
    activeRules: scalar("SELECT COUNT(*) AS n FROM reminder_rules WHERE is_active = 1"),
    dueToday: due.length,
    queued: notifications.countByStatus(conn, "queued"),
    failed: notifications.countByStatus(conn, "failed"),
    sentToday: notifications.sentOn(conn, today),
    lastSweep: settings.get(conn, "last_sweep_at"),
    clientsOptedOut: scalar(
      "SELECT COUNT(*) AS n FROM clients WHERE reminders_opted_out = 1 AND is_archived = 0",
    ),
    expiringWithoutEmail: scalar(
      "SELECT COUNT(*) AS n FROM policy_overview " +
        "WHERE status = 'active' AND expiry_date <= ? " +
        "AND (client_email IS NULL OR trim(client_email) = '')",
      dayAfter(today, window),
    ),
  };
}

/**
 * Reachable only if the machine's clock hands back a day that cannot be read,
 * which `chrono` makes impossible on the Rust side.
 */
function dayAfter(isoDate: string, days: number): string {
  const moved = addDays(isoDate, days);
  if (moved === null) throw AppError.other(`\`${isoDate}\` is not a date`);
  return moved;
}

/**
 * `last_sweep_at` is read back by the tick as a local calendar day, so it is
 * written with the local offset the way `chrono::Local::now().to_rfc3339()` does.
 */
function localStamp(now: Date): string {
  const pad = (value: number) => `${value}`.padStart(2, "0");
  const offset = -now.getTimezoneOffset();
  const magnitude = Math.abs(offset);
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${offset < 0 ? "-" : "+"}${pad(Math.floor(magnitude / 60))}:${pad(magnitude % 60)}`
  );
}
