use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{EmailTemplate, EmailTemplateInput, TEMPLATE_COLUMNS};

const TRIGGERS: &[&str] = &[
    "expiry_reminder",
    "post_expiry",
    "welcome",
    "renewal_confirmation",
    "annual_summary",
    "provider_digest",
    "custom",
];

pub fn list(conn: &Connection) -> AppResult<Vec<EmailTemplate>> {
    let sql = format!("SELECT {TEMPLATE_COLUMNS} FROM email_templates t ORDER BY t.name");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], EmailTemplate::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<EmailTemplate> {
    let sql = format!("SELECT {TEMPLATE_COLUMNS} FROM email_templates t WHERE t.id = ?1");
    conn.query_row(&sql, params![id], EmailTemplate::from_row)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound("Template"),
            other => other.into(),
        })
}

/// The active template for a trigger, used when a rule does not name one.
pub fn active_for_trigger(conn: &Connection, trigger: &str) -> AppResult<Option<EmailTemplate>> {
    let sql = format!(
        "SELECT {TEMPLATE_COLUMNS} FROM email_templates t \
         WHERE t.trigger = ?1 AND t.is_active = 1 ORDER BY t.id LIMIT 1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params![trigger])?;
    match rows.next()? {
        Some(row) => Ok(Some(EmailTemplate::from_row(row)?)),
        None => Ok(None),
    }
}

pub fn create(conn: &Connection, input: &EmailTemplateInput) -> AppResult<i64> {
    validate(input)?;
    conn.execute(
        "INSERT INTO email_templates (name, trigger, subject, body_html, is_active) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            input.name.trim(),
            input.trigger.trim(),
            input.subject.trim(),
            input.body_html,
            input.is_active.unwrap_or(true) as i64,
        ],
    )
    .map_err(duplicate_name)?;
    Ok(conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: &EmailTemplateInput) -> AppResult<()> {
    validate(input)?;
    let changed = conn
        .execute(
            "UPDATE email_templates SET name = ?2, trigger = ?3, subject = ?4, body_html = ?5, \
                 is_active = ?6, updated_at = datetime('now') WHERE id = ?1",
            params![
                id,
                input.name.trim(),
                input.trigger.trim(),
                input.subject.trim(),
                input.body_html,
                input.is_active.unwrap_or(true) as i64,
            ],
        )
        .map_err(duplicate_name)?;
    if changed == 0 {
        return Err(AppError::NotFound("Template"));
    }
    Ok(())
}

/// Refuses while a rule still points at it, so a rule cannot silently lose the
/// message it sends.
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let in_use: i64 = conn.query_row(
        "SELECT COUNT(*) FROM reminder_rules WHERE template_id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    if in_use > 0 {
        return Err(AppError::Conflict(format!(
            "{in_use} reminder rules send this template. Point them at another one first."
        )));
    }
    let changed = conn.execute("DELETE FROM email_templates WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound("Template"));
    }
    Ok(())
}

fn validate(input: &EmailTemplateInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::validation("Template name is required"));
    }
    if input.subject.trim().is_empty() {
        return Err(AppError::validation("Subject is required"));
    }
    if input.body_html.trim().is_empty() {
        return Err(AppError::validation("Message body is required"));
    }
    if !TRIGGERS.contains(&input.trigger.trim()) {
        return Err(AppError::validation(format!(
            "`{}` is not a template type",
            input.trigger
        )));
    }
    Ok(())
}

fn duplicate_name(err: rusqlite::Error) -> AppError {
    match &err {
        rusqlite::Error::SqliteFailure(e, _)
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            AppError::Conflict("A template with that name already exists".into())
        }
        _ => err.into(),
    }
}
