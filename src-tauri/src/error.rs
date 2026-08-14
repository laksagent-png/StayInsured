use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("The database is locked. Sign in to continue.")]
    Locked,

    #[error("Incorrect password.")]
    BadPassword,

    #[error("This installation is already set up.")]
    AlreadyInitialised,

    #[error("{0}")]
    Validation(String),

    #[error("{0} was not found.")]
    NotFound(&'static str),

    #[error("{0}")]
    Conflict(String),

    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("File error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Data error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("Spreadsheet error: {0}")]
    Spreadsheet(String),

    #[error("Mail error: {0}")]
    Mail(String),

    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn validation(msg: impl Into<String>) -> Self {
        Self::Validation(msg.into())
    }

    pub fn other(msg: impl Into<String>) -> Self {
        Self::Other(msg.into())
    }

    pub fn mail(msg: impl Into<String>) -> Self {
        Self::Mail(msg.into())
    }

    /// Short machine-readable tag so the UI can react to a class of failure
    /// without string matching the message.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Locked => "locked",
            Self::BadPassword => "bad_password",
            Self::AlreadyInitialised => "already_initialised",
            Self::Validation(_) => "validation",
            Self::NotFound(_) => "not_found",
            Self::Conflict(_) => "conflict",
            Self::Mail(_) => "mail",
            _ => "internal",
        }
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        Self::Other(err.to_string())
    }
}

impl From<calamine::Error> for AppError {
    fn from(err: calamine::Error) -> Self {
        Self::Spreadsheet(err.to_string())
    }
}

impl From<csv::Error> for AppError {
    fn from(err: csv::Error) -> Self {
        Self::Spreadsheet(err.to_string())
    }
}

impl From<rust_xlsxwriter::XlsxError> for AppError {
    fn from(err: rust_xlsxwriter::XlsxError) -> Self {
        Self::Spreadsheet(err.to_string())
    }
}

/// Tauri needs a serialisable error; the UI receives `{ kind, message }`.
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
