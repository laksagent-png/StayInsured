use rusqlite::types::Value;

/// Accumulates WHERE fragments with their bound values.
///
/// Values are always bound, never interpolated. Column and direction names come
/// from `allow`-lists so that user-chosen sorting cannot reach the SQL text.
#[derive(Debug, Default)]
pub struct Conditions {
    clauses: Vec<String>,
    params: Vec<Value>,
}

impl Conditions {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a clause containing one `?` placeholder.
    pub fn add(&mut self, clause: &str, value: impl Into<Value>) {
        self.clauses.push(clause.to_string());
        self.params.push(value.into());
    }

    /// Adds a clause whose placeholders are filled from several values.
    pub fn add_many(&mut self, clause: String, values: impl IntoIterator<Item = Value>) {
        self.clauses.push(clause);
        self.params.extend(values);
    }

    /// Adds a clause with no bound values.
    pub fn add_raw(&mut self, clause: &str) {
        self.clauses.push(clause.to_string());
    }

    pub fn where_sql(&self) -> String {
        if self.clauses.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", self.clauses.join(" AND "))
        }
    }

    pub fn params(&self) -> &[Value] {
        &self.params
    }

    /// Copy of the bound values with pagination appended, for the page query.
    pub fn params_with(&self, extra: [i64; 2]) -> Vec<Value> {
        let mut out = self.params.clone();
        out.push(Value::Integer(extra[0]));
        out.push(Value::Integer(extra[1]));
        out
    }
}

/// Builds `IN (?, ?, ?)` for a list of strings, rejecting anything outside `allowed`.
pub fn in_clause(column: &str, values: &[String], allowed: &[&str]) -> Option<(String, Vec<Value>)> {
    let kept: Vec<String> = values
        .iter()
        .map(|v| v.trim().to_lowercase())
        .filter(|v| allowed.contains(&v.as_str()))
        .collect();
    if kept.is_empty() {
        return None;
    }
    let placeholders = vec!["?"; kept.len()].join(", ");
    Some((
        format!("{column} IN ({placeholders})"),
        kept.into_iter().map(Value::Text).collect(),
    ))
}

/// Resolves a requested sort column against an allow-list.
pub fn order_by(requested: Option<&str>, descending: bool, allowed: &[(&str, &str)], fallback: &str) -> String {
    let column = requested
        .and_then(|key| {
            allowed
                .iter()
                .find(|(name, _)| *name == key)
                .map(|(_, sql)| *sql)
        })
        .unwrap_or(fallback);
    let direction = if descending { "DESC" } else { "ASC" };
    format!(" ORDER BY {column} {direction}")
}

pub fn paginate(page: Option<u32>, page_size: Option<u32>) -> (u32, u32, i64, i64) {
    let size = page_size.unwrap_or(50).clamp(1, 500);
    let page = page.unwrap_or(1).max(1);
    let offset = ((page - 1) as i64) * size as i64;
    (page, size, size as i64, offset)
}

/// Turns free text into a LIKE pattern, escaping the wildcard characters.
pub fn like_pattern(search: &str) -> String {
    let escaped = search
        .trim()
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}
