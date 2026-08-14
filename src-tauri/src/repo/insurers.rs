use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{blank_to_none, Insurer, InsurerInput, LookupItem};

const COLUMNS: &str = "i.id, i.name, i.short_code, i.website, i.claim_helpline, i.support_email, \
     i.notes, i.is_active, (SELECT COUNT(*) FROM policies p WHERE p.insurer_id = i.id) AS policy_count";

pub fn list(conn: &Connection, include_inactive: bool) -> AppResult<Vec<Insurer>> {
    let filter = if include_inactive {
        ""
    } else {
        " WHERE i.is_active = 1"
    };
    let sql = format!("SELECT {COLUMNS} FROM insurers i{filter} ORDER BY i.name");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], Insurer::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Insurers that already carry policies, most used first — what the pickers show.
pub fn lookup(conn: &Connection) -> AppResult<Vec<LookupItem>> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.name, i.short_code FROM insurers i WHERE i.is_active = 1 \
         ORDER BY (SELECT COUNT(*) FROM policies p WHERE p.insurer_id = i.id) DESC, i.name",
    )?;
    let rows = stmt
        .query_map([], LookupItem::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn create(conn: &Connection, input: &InsurerInput) -> AppResult<i64> {
    if input.name.trim().is_empty() {
        return Err(AppError::validation("Insurer name is required"));
    }
    conn.execute(
        "INSERT INTO insurers (name, short_code, website, claim_helpline, support_email, notes, is_active) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            input.name.trim(),
            blank_to_none(input.short_code.clone()).map(|c| c.to_uppercase()),
            blank_to_none(input.website.clone()),
            blank_to_none(input.claim_helpline.clone()),
            blank_to_none(input.support_email.clone()),
            blank_to_none(input.notes.clone()),
            input.is_active.unwrap_or(true) as i64,
        ],
    )
    .map_err(duplicate_name)?;
    Ok(conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: &InsurerInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::validation("Insurer name is required"));
    }
    let changed = conn
        .execute(
            "UPDATE insurers SET name = ?2, short_code = ?3, website = ?4, claim_helpline = ?5, \
                 support_email = ?6, notes = ?7, is_active = ?8, updated_at = datetime('now') \
             WHERE id = ?1",
            params![
                id,
                input.name.trim(),
                blank_to_none(input.short_code.clone()).map(|c| c.to_uppercase()),
                blank_to_none(input.website.clone()),
                blank_to_none(input.claim_helpline.clone()),
                blank_to_none(input.support_email.clone()),
                blank_to_none(input.notes.clone()),
                input.is_active.unwrap_or(true) as i64,
            ],
        )
        .map_err(duplicate_name)?;
    if changed == 0 {
        return Err(AppError::NotFound("Insurer"));
    }
    Ok(())
}

/// Refuses to delete an insurer that policies still point at; deactivating is
/// the intended way to retire one.
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let in_use: i64 = conn.query_row(
        "SELECT COUNT(*) FROM policies WHERE insurer_id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    if in_use > 0 {
        return Err(AppError::Conflict(format!(
            "{in_use} policies are with this insurer. Deactivate it instead of deleting."
        )));
    }
    let changed = conn.execute("DELETE FROM insurers WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound("Insurer"));
    }
    Ok(())
}

/// Resolves a name from a spreadsheet to an insurer, creating one if needed.
pub fn find_or_create(conn: &Connection, name: &str) -> AppResult<i64> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("Insurer name is missing"));
    }

    let exact: Option<i64> = conn
        .query_row(
            "SELECT id FROM insurers WHERE lower(name) = lower(?1) OR lower(short_code) = lower(?1)",
            params![trimmed],
            |row| row.get(0),
        )
        .ok();
    if let Some(id) = exact {
        return Ok(id);
    }

    // Spreadsheets abbreviate; match on a contained name before creating a duplicate.
    let partial: Option<i64> = conn
        .query_row(
            "SELECT id FROM insurers \
             WHERE lower(name) LIKE '%' || lower(?1) || '%' OR lower(?1) LIKE '%' || lower(name) || '%' \
             ORDER BY length(name) LIMIT 1",
            params![trimmed],
            |row| row.get(0),
        )
        .ok();
    if let Some(id) = partial {
        return Ok(id);
    }

    create(
        conn,
        &InsurerInput {
            name: trimmed.to_string(),
            short_code: None,
            website: None,
            claim_helpline: None,
            support_email: None,
            notes: Some("Added automatically during import".into()),
            is_active: Some(true),
        },
    )
}

fn duplicate_name(err: rusqlite::Error) -> AppError {
    match &err {
        rusqlite::Error::SqliteFailure(e, _)
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            AppError::Conflict("An insurer with that name already exists".into())
        }
        _ => err.into(),
    }
}
