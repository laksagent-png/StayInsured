//! The outbox.
//!
//! A row is written before anything is sent. `UNIQUE (rule_id, policy_id,
//! policy_period)` is what makes a reminder fire exactly once per policy year,
//! however many times the sweep runs or the app restarts, and it is why a
//! crash mid-send costs at most one duplicate rather than a mailshot.

use rusqlite::{params, types::Value, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{Notification, NotificationFilter, Page, NOTIFICATION_COLUMNS};
use crate::query::{self, Conditions};

pub const STATUSES: &[&str] = &["queued", "sent", "failed", "skipped", "cancelled"];

const SORTABLE: &[(&str, &str)] = &[
    ("scheduledFor", "n.scheduled_for"),
    ("createdAt", "n.created_at"),
    ("sentAt", "n.sent_at"),
    ("status", "n.status"),
    ("clientName", "client_name"),
];

/// What goes into the outbox before sending.
pub struct NewNotification {
    pub rule_id: i64,
    pub policy_id: i64,
    pub client_id: i64,
    pub policy_period: String,
    pub audience: String,
    pub channel: String,
    pub to_address: Option<String>,
    pub subject: String,
    pub body: String,
    pub scheduled_for: String,
}

/// The message itself, fetched only when a row is about to be sent — the
/// snapshots are large and no list needs them.
pub struct Payload {
    pub id: i64,
    pub channel: String,
    pub to_address: Option<String>,
    pub client_name: String,
    pub subject: String,
    pub body: String,
}

/// Returns the new row id, or None when this reminder already exists for this
/// policy year and nothing was written.
pub fn queue(conn: &Connection, entry: &NewNotification) -> AppResult<Option<i64>> {
    let changed = conn.execute(
        "INSERT OR IGNORE INTO notification_log (rule_id, policy_id, client_id, policy_period, \
             audience, channel, to_address, subject, body_snapshot, status, scheduled_for) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'queued', ?10)",
        params![
            entry.rule_id,
            entry.policy_id,
            entry.client_id,
            entry.policy_period,
            entry.audience,
            entry.channel,
            entry.to_address,
            entry.subject,
            entry.body,
            entry.scheduled_for,
        ],
    )?;
    Ok(if changed == 0 {
        None
    } else {
        Some(conn.last_insert_rowid())
    })
}

/// Whether this rule has already been recorded against this policy year, in any
/// state. Used by the planner so a preview does not offer what will be ignored.
pub fn already_logged(
    conn: &Connection,
    rule_id: i64,
    policy_id: i64,
    period: &str,
) -> AppResult<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM notification_log \
         WHERE rule_id = ?1 AND policy_id = ?2 AND policy_period = ?3",
        params![rule_id, policy_id, period],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Queued rows whose time has come, oldest first so a backlog drains in order.
pub fn due(conn: &Connection, now_iso: &str, limit: i64) -> AppResult<Vec<Payload>> {
    let mut stmt = conn.prepare(
        "SELECT n.id, n.channel, n.to_address, \
                COALESCE((SELECT c.full_name FROM clients c WHERE c.id = n.client_id), ''), \
                COALESCE(n.subject, ''), COALESCE(n.body_snapshot, '') \
         FROM notification_log n \
         WHERE n.status = 'queued' AND n.scheduled_for <= ?1 \
         ORDER BY n.scheduled_for, n.id LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![now_iso, limit], |row| {
            Ok(Payload {
                id: row.get(0)?,
                channel: row.get(1)?,
                to_address: row.get(2)?,
                client_name: row.get(3)?,
                subject: row.get(4)?,
                body: row.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn mark_sent(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE notification_log SET status = 'sent', attempts = attempts + 1, \
             last_error = NULL, sent_at = datetime('now') WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

/// Stays `queued` for the first few attempts so the next sweep picks it up; a
/// server that is down for an hour should not need the operator to intervene.
pub fn mark_attempt_failed(
    conn: &Connection,
    id: i64,
    error: &str,
    max_attempts: i64,
) -> AppResult<()> {
    conn.execute(
        "UPDATE notification_log \
         SET attempts = attempts + 1, last_error = ?2, \
             status = CASE WHEN attempts + 1 >= ?3 THEN 'failed' ELSE 'queued' END \
         WHERE id = ?1",
        params![id, error, max_attempts],
    )?;
    Ok(())
}

pub fn mark_skipped(conn: &Connection, id: i64, reason: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE notification_log SET status = 'skipped', last_error = ?2 WHERE id = ?1",
        params![id, reason],
    )?;
    Ok(())
}

/// Puts a failed or cancelled row back in the queue for the next sweep.
pub fn requeue(conn: &Connection, id: i64) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE notification_log SET status = 'queued', attempts = 0, last_error = NULL, \
             scheduled_for = datetime('now') WHERE id = ?1 AND status IN ('failed', 'cancelled', 'skipped')",
        params![id],
    )?;
    if changed == 0 {
        return Err(AppError::Conflict(
            "Only a failed, skipped or cancelled reminder can be sent again".into(),
        ));
    }
    Ok(())
}

pub fn cancel(conn: &Connection, id: i64) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE notification_log SET status = 'cancelled' WHERE id = ?1 AND status = 'queued'",
        params![id],
    )?;
    if changed == 0 {
        return Err(AppError::Conflict(
            "Only a queued reminder can be cancelled".into(),
        ));
    }
    Ok(())
}

pub fn list(conn: &Connection, filter: &NotificationFilter) -> AppResult<Page<Notification>> {
    let mut conditions = Conditions::new();

    if let Some(statuses) = &filter.statuses {
        if let Some((clause, values)) = query::in_clause("n.status", statuses, STATUSES) {
            conditions.add_many(clause, values);
        }
    }
    if let Some(client_id) = filter.client_id {
        conditions.add("n.client_id = ?", client_id);
    }
    if let Some(policy_id) = filter.policy_id {
        conditions.add("n.policy_id = ?", policy_id);
    }
    if let Some(search) = filter.search.as_ref().filter(|s| !s.trim().is_empty()) {
        let pattern = query::like_pattern(search);
        conditions.add_many(
            "(n.to_address LIKE ? ESCAPE '\\' OR n.subject LIKE ? ESCAPE '\\' \
              OR EXISTS (SELECT 1 FROM clients c WHERE c.id = n.client_id \
                         AND c.full_name LIKE ? ESCAPE '\\'))"
                .to_string(),
            vec![
                Value::Text(pattern.clone()),
                Value::Text(pattern.clone()),
                Value::Text(pattern),
            ],
        );
    }

    let where_sql = conditions.where_sql();
    let total = super::count(
        conn,
        &format!("SELECT COUNT(*) FROM notification_log n{where_sql}"),
        conditions.params(),
    )?;

    let (page, page_size, limit, offset) = query::paginate(filter.page, filter.page_size);
    let order = query::order_by(
        filter.sort.as_deref(),
        filter.descending.unwrap_or(true),
        SORTABLE,
        "n.scheduled_for",
    );
    let sql = format!(
        "SELECT {NOTIFICATION_COLUMNS} FROM notification_log n{where_sql}{order} LIMIT ? OFFSET ?"
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(conditions.params_with([limit, offset])),
            Notification::from_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(Page {
        rows,
        total,
        page,
        page_size,
    })
}

pub fn count_by_status(conn: &Connection, status: &str) -> AppResult<i64> {
    let count = conn.query_row(
        "SELECT COUNT(*) FROM notification_log WHERE status = ?1",
        params![status],
        |row| row.get(0),
    )?;
    Ok(count)
}

pub fn sent_on(conn: &Connection, day_iso: &str) -> AppResult<i64> {
    let count = conn.query_row(
        "SELECT COUNT(*) FROM notification_log WHERE status = 'sent' AND date(sent_at) = ?1",
        params![day_iso],
        |row| row.get(0),
    )?;
    Ok(count)
}

/// Clears rows for a policy year that has since been renewed, so a reminder
/// queued yesterday does not chase a client who has already renewed.
pub fn cancel_for_policy(conn: &Connection, policy_id: i64) -> AppResult<usize> {
    let changed = conn.execute(
        "UPDATE notification_log SET status = 'cancelled', \
             last_error = 'The policy was renewed' \
         WHERE policy_id = ?1 AND status = 'queued'",
        params![policy_id],
    )?;
    Ok(changed)
}
