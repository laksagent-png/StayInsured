pub mod migrations;

use std::path::Path;

use parking_lot::Mutex;
use rusqlite::{Connection, OpenFlags, Transaction};

use crate::error::{AppError, AppResult};

/// A single encrypted SQLite connection behind a mutex.
///
/// A desktop app has one writer and short-lived reads, so a connection pool buys
/// nothing here and would complicate the SQLCipher key handling.
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Opens (creating if needed) the encrypted database and brings the schema
    /// up to the latest migration. `key_hex` must be 64 hex characters.
    pub fn open(path: &Path, key_hex: &str) -> AppResult<Self> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )?;

        apply_key(&conn, key_hex)?;
        verify_readable(&conn)?;

        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "busy_timeout", 5_000)?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.with_tx(migrations::apply)?;
        Ok(db)
    }

    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let conn = self.conn.lock();
        f(&conn)
    }

    pub fn with_tx<T>(&self, f: impl FnOnce(&Transaction) -> AppResult<T>) -> AppResult<T> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let out = f(&tx)?;
        tx.commit()?;
        Ok(out)
    }

    /// Re-keys the database in place, used when the password is changed.
    pub fn rekey(&self, new_key_hex: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute_batch(&format!("PRAGMA rekey = \"x'{new_key_hex}'\";"))?;
        Ok(())
    }

    /// Consistent copy of the live database, safe to take while the app is running.
    ///
    /// SQLCipher rejects the online backup API, so this uses VACUUM INTO, which
    /// writes a compacted copy encrypted with the same key.
    pub fn backup_to(&self, dest: &Path) -> AppResult<()> {
        if dest.exists() {
            std::fs::remove_file(dest)?;
        }
        let conn = self.conn.lock();
        let target = dest.to_string_lossy().replace('\'', "''");
        conn.execute_batch(&format!("VACUUM INTO '{target}';"))?;
        Ok(())
    }
}

fn apply_key(conn: &Connection, key_hex: &str) -> AppResult<()> {
    if key_hex.len() != 64 || !key_hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::other("encryption key is malformed"));
    }
    // Raw key form: SQLCipher uses the bytes directly instead of running its own
    // KDF, because the password has already been stretched with Argon2id.
    conn.execute_batch(&format!("PRAGMA key = \"x'{key_hex}'\";"))?;
    Ok(())
}

fn verify_readable(conn: &Connection) -> AppResult<()> {
    match conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    }) {
        Ok(_) => Ok(()),
        // A wrong key surfaces as a corruption-shaped error rather than a
        // dedicated one, so treat those as an authentication failure.
        Err(rusqlite::Error::SqliteFailure(err, _))
            if matches!(err.code, rusqlite::ErrorCode::NotADatabase)
                || matches!(err.code, rusqlite::ErrorCode::DatabaseCorrupt) =>
        {
            Err(AppError::BadPassword)
        }
        Err(other) => Err(other.into()),
    }
}
