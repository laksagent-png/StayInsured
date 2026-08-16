use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{blank_to_none, ReminderRule, ReminderRuleInput, RULE_COLUMNS};
use crate::util::CATEGORIES;

const AUDIENCES: &[&str] = &["client", "provider"];
const CHANNELS: &[&str] = &["email", "desktop", "both"];

/// Ordered the way the ladder reads: furthest ahead of expiry first.
pub fn list(conn: &Connection) -> AppResult<Vec<ReminderRule>> {
    let sql = format!(
        "SELECT {RULE_COLUMNS} FROM reminder_rules r ORDER BY r.offset_days DESC, r.sort_order, r.name"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], ReminderRule::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn active(conn: &Connection) -> AppResult<Vec<ReminderRule>> {
    Ok(list(conn)?.into_iter().filter(|r| r.is_active).collect())
}

pub fn create(conn: &Connection, input: &ReminderRuleInput) -> AppResult<i64> {
    validate(conn, input)?;
    // A rule the form does not place goes last. Defaulting to 0 put every new
    // rule above the seeded ones, so the list reordered itself on each save.
    let sort_order = match input.sort_order {
        Some(order) => order,
        None => conn.query_row(
            "SELECT IFNULL(MAX(sort_order), 0) + 1 FROM reminder_rules",
            [],
            |row| row.get::<_, i64>(0),
        )?,
    };
    conn.execute(
        "INSERT INTO reminder_rules (name, offset_days, category, audience, channel, template_id, \
             is_active, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            input.name.trim(),
            input.offset_days,
            blank_to_none(input.category.clone()),
            input.audience.trim(),
            input.channel.trim(),
            input.template_id,
            input.is_active.unwrap_or(true) as i64,
            sort_order,
        ],
    )
    .map_err(duplicate_name)?;
    Ok(conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: &ReminderRuleInput) -> AppResult<()> {
    validate(conn, input)?;
    let changed = conn
        .execute(
            "UPDATE reminder_rules SET name = ?2, offset_days = ?3, category = ?4, audience = ?5, \
                 channel = ?6, template_id = ?7, is_active = ?8, \
                 sort_order = COALESCE(?9, sort_order), \
                 updated_at = datetime('now') WHERE id = ?1",
            params![
                id,
                input.name.trim(),
                input.offset_days,
                blank_to_none(input.category.clone()),
                input.audience.trim(),
                input.channel.trim(),
                input.template_id,
                input.is_active.unwrap_or(true) as i64,
                // Left out, the rule keeps the place it already had.
                input.sort_order,
            ],
        )
        .map_err(duplicate_name)?;
    if changed == 0 {
        return Err(AppError::NotFound("Reminder rule"));
    }
    Ok(())
}

/// Deleting a rule leaves its history behind: `notification_log.rule_id` becomes
/// NULL rather than the rows disappearing, so the record of what was sent stays
/// intact.
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM reminder_rules WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound("Reminder rule"));
    }
    Ok(())
}

fn validate(conn: &Connection, input: &ReminderRuleInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::validation("Rule name is required"));
    }
    if !(-365..=365).contains(&input.offset_days) {
        return Err(AppError::validation(
            "Timing must be within a year either side of expiry",
        ));
    }
    if !AUDIENCES.contains(&input.audience.trim()) {
        return Err(AppError::validation("Audience must be client or provider"));
    }
    if !CHANNELS.contains(&input.channel.trim()) {
        return Err(AppError::validation(
            "Channel must be email, desktop or both",
        ));
    }
    if let Some(category) = blank_to_none(input.category.clone()) {
        if !CATEGORIES.contains(&category.as_str()) {
            return Err(AppError::validation(format!(
                "`{category}` is not a policy category"
            )));
        }
    }
    if let Some(template_id) = input.template_id {
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM email_templates WHERE id = ?1",
            params![template_id],
            |row| row.get(0),
        )?;
        if exists == 0 {
            return Err(AppError::NotFound("Template"));
        }
    } else if input.audience.trim() == "client" {
        // A client rule with no template has nothing to say.
        return Err(AppError::validation(
            "Choose the message this rule sends to the client",
        ));
    }
    Ok(())
}

fn duplicate_name(err: rusqlite::Error) -> AppError {
    match &err {
        rusqlite::Error::SqliteFailure(e, _)
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            AppError::Conflict("A rule with that name already exists".into())
        }
        _ => err.into(),
    }
}
