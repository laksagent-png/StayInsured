use rusqlite::Transaction;

use crate::error::AppResult;

/// Ordered schema steps. Never edit a shipped entry; add a new one instead.
const MIGRATIONS: &[(i32, &str)] = &[
    (1, include_str!("schema/001_init.sql")),
    (2, include_str!("schema/002_seed.sql")),
    (3, include_str!("schema/003_documents.sql")),
    (4, include_str!("schema/004_search_index.sql")),
    (5, include_str!("schema/005_client_relations.sql")),
];

pub fn apply(tx: &Transaction) -> AppResult<()> {
    let current: i32 = tx.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    for (version, sql) in MIGRATIONS {
        if *version <= current {
            continue;
        }
        tracing::info!(version, "applying migration");
        tx.execute_batch(sql)?;
        // PRAGMA user_version does not accept bound parameters.
        tx.execute_batch(&format!("PRAGMA user_version = {version};"))?;
    }

    Ok(())
}

pub fn latest_version() -> i32 {
    MIGRATIONS.last().map(|(v, _)| *v).unwrap_or(0)
}
