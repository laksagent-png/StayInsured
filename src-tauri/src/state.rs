use std::sync::Arc;

use parking_lot::RwLock;

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::paths::AppPaths;

/// Shared handle for the Tauri commands. The database is absent until the user
/// signs in, which is what makes "locked" a real state rather than a UI flag.
pub struct AppState {
    pub paths: AppPaths,
    db: RwLock<Option<Arc<Database>>>,
}

impl AppState {
    pub fn new(paths: AppPaths) -> Self {
        Self {
            paths,
            db: RwLock::new(None),
        }
    }

    pub fn db(&self) -> AppResult<Arc<Database>> {
        self.db.read().clone().ok_or(AppError::Locked)
    }

    pub fn is_unlocked(&self) -> bool {
        self.db.read().is_some()
    }

    pub fn set_db(&self, db: Database) {
        *self.db.write() = Some(Arc::new(db));
    }

    pub fn lock(&self) {
        *self.db.write() = None;
    }
}
