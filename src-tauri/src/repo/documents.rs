use std::path::Path;

use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::models::{blank_to_none, Document, DocumentInput};

const COLUMNS: &str = "d.id, d.client_id, d.policy_id, p.policy_number, d.title, \
                       d.file_name, d.mime_type, d.size_bytes, d.uploaded_at";

/// Largest single file accepted. A scanned policy schedule runs to two or three
/// megabytes; the ceiling is well clear of that while keeping the book a size
/// that can still be copied to a backup folder on every save.
const MAX_DOCUMENT_BYTES: u64 = 20 * 1024 * 1024;

/// What an agent actually receives from an insurer, and nothing else. The list
/// doubles as the extension-to-type map, since the type is what the viewer
/// dispatches on.
const ACCEPTED: &[(&str, &str)] = &[
    ("pdf", "application/pdf"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
];

pub fn list_for_client(conn: &Connection, client_id: i64) -> AppResult<Vec<Document>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM documents d \
         LEFT JOIN policies p ON p.id = d.policy_id \
         WHERE d.client_id = ?1 ORDER BY d.uploaded_at DESC, d.id DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![client_id], Document::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Copies a file into the book. The original is left where it is: this is a copy
/// in, not a move, so deleting the attachment never touches the agent's own file.
pub fn attach(conn: &Connection, input: &DocumentInput) -> AppResult<i64> {
    let path = Path::new(&input.path);

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::validation("That file has no name"))?
        .to_string();

    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_lowercase();

    let mime_type = ACCEPTED
        .iter()
        .find(|(ext, _)| *ext == extension)
        .map(|(_, mime)| (*mime).to_string())
        .ok_or_else(|| AppError::validation("Attach a PDF or an image (PDF, PNG, JPG or WEBP)"))?;

    let size = std::fs::metadata(path)?.len();
    if size == 0 {
        return Err(AppError::validation("That file is empty"));
    }
    if size > MAX_DOCUMENT_BYTES {
        return Err(AppError::validation(format!(
            "That file is {} and the limit is {}",
            human_size(size),
            human_size(MAX_DOCUMENT_BYTES)
        )));
    }

    let content = std::fs::read(path)?;
    let sha256 = format!("{:x}", Sha256::digest(&content));

    let title = blank_to_none(input.title.clone()).unwrap_or_else(|| {
        path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&file_name)
            .to_string()
    });

    conn.execute(
        "INSERT INTO documents (client_id, policy_id, title, file_name, mime_type, size_bytes, sha256) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            input.client_id,
            input.policy_id,
            title,
            file_name,
            mime_type,
            content.len() as i64,
            sha256,
        ],
    )
    .map_err(map_constraint_error)?;

    let id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO document_contents (document_id, content) VALUES (?1, ?2)",
        params![id, content],
    )?;

    Ok(id)
}

/// The stored bytes, for viewing in the app or writing a copy back out.
pub fn content(conn: &Connection, id: i64) -> AppResult<Vec<u8>> {
    conn.query_row(
        "SELECT content FROM document_contents WHERE document_id = ?1",
        params![id],
        |row| row.get(0),
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound("Document"),
        other => other.into(),
    })
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM documents WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound("Document"));
    }
    Ok(())
}

/// Bytes as a person reads them, used in the messages about the size limit.
fn human_size(bytes: u64) -> String {
    const MB: f64 = (1024 * 1024) as f64;
    const KB: f64 = 1024.0;
    let bytes = bytes as f64;
    if bytes >= MB {
        format!("{:.1} MB", bytes / MB)
    } else {
        format!("{:.0} KB", (bytes / KB).max(1.0))
    }
}

fn map_constraint_error(err: rusqlite::Error) -> AppError {
    match &err {
        rusqlite::Error::SqliteFailure(e, Some(msg))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            if msg.contains("client_id, sha256") {
                AppError::Conflict("That file is already attached to this client.".into())
            } else if msg.contains("FOREIGN KEY") {
                AppError::validation("Attach the document to an existing client and policy")
            } else {
                AppError::Conflict(msg.clone())
            }
        }
        _ => err.into(),
    }
}
