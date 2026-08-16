/** A port of `src-tauri/src/repo/templates.rs`. */

import type { Conn } from "../db";
import { AppError } from "../errors";
import { boolToInt, toModel, toModels } from "../rows";
import type { EmailTemplate, EmailTemplateInput } from "../types";
import { isConstraintViolation } from "./shared";

const TRIGGERS = [
  "expiry_reminder",
  "post_expiry",
  "welcome",
  "renewal_confirmation",
  "annual_summary",
  "provider_digest",
  "custom",
];

const COLUMNS =
  "t.id, t.name, t.trigger, t.subject, t.body_html, t.is_active, t.created_at, t.updated_at, " +
  "(SELECT COUNT(*) FROM reminder_rules r WHERE r.template_id = t.id) AS used_by_rules";

export function list(conn: Conn): EmailTemplate[] {
  const rows = conn
    .prepare(`SELECT ${COLUMNS} FROM email_templates t ORDER BY t.name`)
    .all() as Record<string, unknown>[];
  return toModels<EmailTemplate>(rows);
}

export function get(conn: Conn, id: number): EmailTemplate {
  const row = conn.prepare(`SELECT ${COLUMNS} FROM email_templates t WHERE t.id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw AppError.notFound("Template");
  return toModel<EmailTemplate>(row);
}

/** The active template for a trigger, used when a rule does not name one. */
export function activeForTrigger(conn: Conn, trigger: string): EmailTemplate | null {
  const row = conn
    .prepare(
      `SELECT ${COLUMNS} FROM email_templates t ` +
        "WHERE t.trigger = ? AND t.is_active = 1 ORDER BY t.id LIMIT 1",
    )
    .get(trigger) as Record<string, unknown> | undefined;
  return row ? toModel<EmailTemplate>(row) : null;
}

export function create(conn: Conn, input: EmailTemplateInput): number {
  validate(input);
  try {
    const result = conn
      .prepare(
        "INSERT INTO email_templates (name, trigger, subject, body_html, is_active) " +
          "VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        input.name.trim(),
        input.trigger.trim(),
        input.subject.trim(),
        input.bodyHtml,
        boolToInt(input.isActive ?? true),
      );
    return Number(result.lastInsertRowid);
  } catch (error) {
    throw duplicateName(error);
  }
}

export function update(conn: Conn, id: number, input: EmailTemplateInput): void {
  validate(input);

  let changes: number;
  try {
    const result = conn
      .prepare(
        "UPDATE email_templates SET name = ?, trigger = ?, subject = ?, body_html = ?, " +
          "is_active = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(
        input.name.trim(),
        input.trigger.trim(),
        input.subject.trim(),
        input.bodyHtml,
        boolToInt(input.isActive ?? true),
        id,
      );
    changes = result.changes;
  } catch (error) {
    throw duplicateName(error);
  }

  if (changes === 0) throw AppError.notFound("Template");
}

/**
 * Refuses while a rule still points at it, so a rule cannot silently lose the
 * message it sends.
 */
export function remove(conn: Conn, id: number): void {
  const inUse = (
    conn.prepare("SELECT COUNT(*) AS n FROM reminder_rules WHERE template_id = ?").get(id) as {
      n: number;
    }
  ).n;
  if (inUse > 0) {
    throw AppError.conflict(
      `${inUse} reminder rules send this template. Point them at another one first.`,
    );
  }

  const result = conn.prepare("DELETE FROM email_templates WHERE id = ?").run(id);
  if (result.changes === 0) throw AppError.notFound("Template");
}

function validate(input: EmailTemplateInput): void {
  if (input.name.trim() === "") throw AppError.validation("Template name is required");
  if (input.subject.trim() === "") throw AppError.validation("Subject is required");
  if (input.bodyHtml.trim() === "") throw AppError.validation("Message body is required");
  if (!TRIGGERS.includes(input.trigger.trim())) {
    throw AppError.validation(`\`${input.trigger}\` is not a template type`);
  }
}

function duplicateName(error: unknown): AppError {
  if (isConstraintViolation(error)) {
    return AppError.conflict("A template with that name already exists");
  }
  return AppError.database(error);
}
