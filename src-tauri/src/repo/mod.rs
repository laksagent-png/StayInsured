pub mod clients;
pub mod dashboard;
pub mod documents;
pub mod insurers;
pub mod members;
pub mod notifications;
pub mod policies;
pub mod products;
pub mod rules;
pub mod settings;
pub mod templates;

use rusqlite::Connection;

use crate::error::AppResult;

/// Sanitises free text into an FTS5 prefix query. Returns None when nothing
/// searchable is left, so callers can fall back to a LIKE scan.
pub fn fts_query(search: &str) -> Option<String> {
    let tokens: Vec<String> = search
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"*", t.to_lowercase()))
        .collect();
    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" AND "))
    }
}

pub fn count(conn: &Connection, sql: &str, params: &[rusqlite::types::Value]) -> AppResult<i64> {
    let total = conn.query_row(sql, rusqlite::params_from_iter(params), |row| row.get(0))?;
    Ok(total)
}
