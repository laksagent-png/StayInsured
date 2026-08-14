use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{blank_to_none, InsuredMember, MemberInput};
use crate::util;

const COLUMNS: &str = "id, client_id, full_name, relationship, date_of_birth, gender, notes";

pub fn list_for_client(conn: &Connection, client_id: i64) -> AppResult<Vec<InsuredMember>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM insured_members WHERE client_id = ?1 \
         ORDER BY CASE relationship WHEN 'self' THEN 0 WHEN 'spouse' THEN 1 ELSE 2 END, full_name"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![client_id], InsuredMember::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn create(conn: &Connection, input: &MemberInput) -> AppResult<i64> {
    if input.full_name.trim().is_empty() {
        return Err(AppError::validation("Member name is required"));
    }
    conn.execute(
        "INSERT INTO insured_members (client_id, full_name, relationship, date_of_birth, gender, notes) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            input.client_id,
            util::tidy_name(&input.full_name),
            input
                .relationship
                .as_deref()
                .map(util::normalise_relationship)
                .unwrap_or_else(|| "other".into()),
            blank_to_none(input.date_of_birth.clone()).and_then(|d| util::parse_date(&d)),
            blank_to_none(input.gender.clone()),
            blank_to_none(input.notes.clone()),
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: &MemberInput) -> AppResult<()> {
    if input.full_name.trim().is_empty() {
        return Err(AppError::validation("Member name is required"));
    }
    let changed = conn.execute(
        "UPDATE insured_members SET full_name = ?2, relationship = ?3, date_of_birth = ?4, \
             gender = ?5, notes = ?6 WHERE id = ?1",
        params![
            id,
            util::tidy_name(&input.full_name),
            input
                .relationship
                .as_deref()
                .map(util::normalise_relationship)
                .unwrap_or_else(|| "other".into()),
            blank_to_none(input.date_of_birth.clone()).and_then(|d| util::parse_date(&d)),
            blank_to_none(input.gender.clone()),
            blank_to_none(input.notes.clone()),
        ],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("Member"));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM insured_members WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound("Member"));
    }
    Ok(())
}

/// Used by the importer, which sees a member name rather than an id.
pub fn find_or_create(
    conn: &Connection,
    client_id: i64,
    name: &str,
    relationship: Option<&str>,
) -> AppResult<i64> {
    let tidy = util::tidy_name(name);
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM insured_members WHERE client_id = ?1 AND lower(full_name) = lower(?2)",
            params![client_id, tidy],
            |row| row.get(0),
        )
        .ok();
    if let Some(id) = existing {
        return Ok(id);
    }
    create(
        conn,
        &MemberInput {
            client_id,
            full_name: tidy,
            relationship: relationship.map(str::to_string),
            date_of_birth: None,
            gender: None,
            notes: None,
        },
    )
}
