use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{blank_to_none, Product, ProductInput};
use crate::util;

const COLUMNS: &str = "p.id, p.insurer_id, i.name AS insurer_name, p.name, p.category, p.code, \
     p.notes, p.is_active, (SELECT COUNT(*) FROM policies po WHERE po.product_id = p.id) AS policy_count";

pub fn list(
    conn: &Connection,
    insurer_id: Option<i64>,
    include_inactive: bool,
) -> AppResult<Vec<Product>> {
    let mut clauses: Vec<String> = Vec::new();
    if !include_inactive {
        clauses.push("p.is_active = 1".into());
    }
    if let Some(id) = insurer_id {
        clauses.push(format!("p.insurer_id = {id}"));
    }
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };

    let sql = format!(
        "SELECT {COLUMNS} FROM products p JOIN insurers i ON i.id = p.insurer_id{where_sql} \
         ORDER BY i.name, p.name"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], Product::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn validate(input: &ProductInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::validation("Plan name is required"));
    }
    if !util::CATEGORIES.contains(&input.category.as_str()) {
        return Err(AppError::validation(format!(
            "\"{}\" is not a known category",
            input.category
        )));
    }
    Ok(())
}

pub fn create(conn: &Connection, input: &ProductInput) -> AppResult<i64> {
    validate(input)?;
    conn.execute(
        "INSERT INTO products (insurer_id, name, category, code, notes, is_active) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            input.insurer_id,
            input.name.trim(),
            input.category,
            blank_to_none(input.code.clone()),
            blank_to_none(input.notes.clone()),
            input.is_active.unwrap_or(true) as i64,
        ],
    )
    .map_err(duplicate)?;
    Ok(conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: &ProductInput) -> AppResult<()> {
    validate(input)?;
    let changed = conn
        .execute(
            "UPDATE products SET insurer_id = ?2, name = ?3, category = ?4, code = ?5, notes = ?6, \
                 is_active = ?7, updated_at = datetime('now') WHERE id = ?1",
            params![
                id,
                input.insurer_id,
                input.name.trim(),
                input.category,
                blank_to_none(input.code.clone()),
                blank_to_none(input.notes.clone()),
                input.is_active.unwrap_or(true) as i64,
            ],
        )
        .map_err(duplicate)?;
    if changed == 0 {
        return Err(AppError::NotFound("Plan"));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM products WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound("Plan"));
    }
    Ok(())
}

pub fn find_or_create(
    conn: &Connection,
    insurer_id: i64,
    name: &str,
    category: &str,
) -> AppResult<Option<i64>> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM products WHERE insurer_id = ?1 AND lower(name) = lower(?2)",
            params![insurer_id, trimmed],
            |row| row.get(0),
        )
        .ok();
    if let Some(id) = existing {
        return Ok(Some(id));
    }
    let id = create(
        conn,
        &ProductInput {
            insurer_id,
            name: trimmed.to_string(),
            category: category.to_string(),
            code: None,
            notes: Some("Added automatically during import".into()),
            is_active: Some(true),
        },
    )?;
    Ok(Some(id))
}

fn duplicate(err: rusqlite::Error) -> AppError {
    match &err {
        rusqlite::Error::SqliteFailure(e, _)
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            AppError::Conflict("This insurer already has a plan with that name".into())
        }
        _ => err.into(),
    }
}
