use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// Everything the app writes lives under one directory so that a backup or a
/// move to another machine is a single folder copy.
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub root: PathBuf,
    pub database: PathBuf,
    pub vault: PathBuf,
    pub documents: PathBuf,
    pub backups: PathBuf,
    pub logs: PathBuf,
}

impl AppPaths {
    pub fn resolve(app: &AppHandle) -> AppResult<Self> {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::other(format!("cannot resolve app data directory: {e}")))?;

        let paths = Self {
            database: root.join("stayinsured.db"),
            vault: root.join("vault.json"),
            documents: root.join("documents"),
            backups: root.join("backups"),
            logs: root.join("logs"),
            root,
        };

        for dir in [
            &paths.root,
            &paths.documents,
            &paths.backups,
            &paths.logs,
        ] {
            std::fs::create_dir_all(dir)?;
        }

        Ok(paths)
    }
}
