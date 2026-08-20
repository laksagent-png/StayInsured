pub mod clients;
pub mod dashboard;
pub mod documents;
pub mod insurers;
pub mod notifications;
pub mod policies;
pub mod products;
pub mod relations;
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

/// Whether a broken constraint names every one of these columns, so that the
/// repositories can tell which rule was broken and answer with advice instead of
/// with SQLite's own wording.
///
/// SQLite writes the columns table-qualified and in the order the index declares
/// them — `UNIQUE constraint failed: documents.client_id, documents.sha256` —
/// which makes the whole phrase a bad thing to look for: a renamed table or a
/// reordered index turns a sentence written for an operator back into that one,
/// and nothing fails until somebody reads it off a screen. Each column is
/// matched on its own and as a whole identifier, so `sha256` is not found inside
/// a `sha256_prefix` added later.
pub fn constraint_names(message: &str, columns: &[&str]) -> bool {
    let words: Vec<&str> = message
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .collect();
    columns.iter().all(|column| words.contains(column))
}
