/** A port of `src-tauri/src/repo/rules.rs`. */

import type { Conn } from "../db";
import { AppError } from "../errors";
import { blankToNull, boolToInt, toModels } from "../rows";
import type { ReminderRule, ReminderRuleInput } from "../types";
import { CATEGORIES } from "../util";
import { isConstraintViolation } from "./shared";

const AUDIENCES = ["client", "provider"];
const CHANNELS = ["email", "desktop", "both"];

const COLUMNS =
  "r.id, r.name, r.offset_days, r.category, r.audience, r.channel, " +
  "r.template_id, (SELECT t.name FROM email_templates t WHERE t.id = r.template_id) AS template_name, " +
  "r.is_active, r.sort_order";

/** Ordered the way the ladder reads: furthest ahead of expiry first. */
export function list(conn: Conn): ReminderRule[] {
  const rows = conn
    .prepare(
      `SELECT ${COLUMNS} FROM reminder_rules r ORDER BY r.offset_days DESC, r.sort_order, r.name`,
    )
    .all() as Record<string, unknown>[];
  return toModels<ReminderRule>(rows);
}

export function active(conn: Conn): ReminderRule[] {
  return list(conn).filter((rule) => rule.isActive);
}

export function create(conn: Conn, input: ReminderRuleInput): number {
  validate(conn, input);

  // A rule the form does not place goes last. Defaulting to 0 put every new rule
  // above the seeded ones, so the list reordered itself on each save.
  const sortOrder =
    input.sortOrder ??
    (
      conn
        .prepare("SELECT IFNULL(MAX(sort_order), 0) + 1 AS next FROM reminder_rules")
        .get() as { next: number }
    ).next;

  try {
    const result = conn
      .prepare(
        "INSERT INTO reminder_rules (name, offset_days, category, audience, channel, template_id, " +
          "is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.name.trim(),
        input.offsetDays,
        blankToNull(input.category),
        input.audience.trim(),
        input.channel.trim(),
        input.templateId ?? null,
        boolToInt(input.isActive ?? true),
        sortOrder,
      );
    return Number(result.lastInsertRowid);
  } catch (error) {
    throw duplicateName(error);
  }
}

export function update(conn: Conn, id: number, input: ReminderRuleInput): void {
  validate(conn, input);

  let changes: number;
  try {
    const result = conn
      .prepare(
        "UPDATE reminder_rules SET name = ?, offset_days = ?, category = ?, audience = ?, " +
          "channel = ?, template_id = ?, is_active = ?, " +
          "sort_order = COALESCE(?, sort_order), " +
          "updated_at = datetime('now') WHERE id = ?",
      )
      .run(
        input.name.trim(),
        input.offsetDays,
        blankToNull(input.category),
        input.audience.trim(),
        input.channel.trim(),
        input.templateId ?? null,
        boolToInt(input.isActive ?? true),
        // Left out, the rule keeps the place it already had.
        input.sortOrder ?? null,
        id,
      );
    changes = result.changes;
  } catch (error) {
    throw duplicateName(error);
  }

  if (changes === 0) throw AppError.notFound("Reminder rule");
}

/**
 * Deleting a rule leaves its history behind: `notification_log.rule_id` becomes
 * NULL rather than the rows disappearing, so the record of what was sent stays
 * intact.
 */
export function remove(conn: Conn, id: number): void {
  const result = conn.prepare("DELETE FROM reminder_rules WHERE id = ?").run(id);
  if (result.changes === 0) throw AppError.notFound("Reminder rule");
}

function validate(conn: Conn, input: ReminderRuleInput): void {
  if (input.name.trim() === "") throw AppError.validation("Rule name is required");
  if (input.offsetDays < -365 || input.offsetDays > 365) {
    throw AppError.validation("Timing must be within a year either side of expiry");
  }
  if (!AUDIENCES.includes(input.audience.trim())) {
    throw AppError.validation("Audience must be client or provider");
  }
  if (!CHANNELS.includes(input.channel.trim())) {
    throw AppError.validation("Channel must be email, desktop or both");
  }

  const category = blankToNull(input.category);
  if (category !== null && !(CATEGORIES as readonly string[]).includes(category)) {
    throw AppError.validation(`\`${category}\` is not a policy category`);
  }

  if (input.templateId != null) {
    const exists = conn
      .prepare("SELECT COUNT(*) AS n FROM email_templates WHERE id = ?")
      .get(input.templateId) as { n: number };
    if (exists.n === 0) throw AppError.notFound("Template");
  } else if (input.audience.trim() === "client") {
    // A client rule with no template has nothing to say.
    throw AppError.validation("Choose the message this rule sends to the client");
  }
}

function duplicateName(error: unknown): AppError {
  if (isConstraintViolation(error)) {
    return AppError.conflict("A rule with that name already exists");
  }
  return AppError.database(error);
}
