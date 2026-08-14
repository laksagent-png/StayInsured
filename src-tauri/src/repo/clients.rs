use rusqlite::{params, params_from_iter, types::Value, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{blank_to_none, Client, ClientFilter, ClientInput, Page, CLIENT_COLUMNS};
use crate::query::{self, Conditions};
use crate::util;

const SORTABLE: &[(&str, &str)] = &[
    ("name", "c.full_name"),
    ("code", "c.client_code"),
    ("city", "c.city"),
    ("created", "c.created_at"),
    ("updated", "c.updated_at"),
    ("policies", "total_policies"),
    ("nextExpiry", "next_expiry"),
];

const DERIVED: &str = "(SELECT COUNT(*) FROM policies p WHERE p.client_id = c.id AND p.status = 'active') AS active_policies, \
     (SELECT COUNT(*) FROM policies p WHERE p.client_id = c.id) AS total_policies, \
     (SELECT MIN(p.expiry_date) FROM policies p WHERE p.client_id = c.id \
        AND p.expiry_date >= date('now', 'localtime')) AS next_expiry";

fn build_conditions(filter: &ClientFilter) -> Conditions {
    let mut c = Conditions::new();

    if !filter.include_archived.unwrap_or(false) {
        c.add_raw("c.is_archived = 0");
    }

    if let Some(search) = filter
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        match super::fts_query(search) {
            Some(q) => c.add(
                "c.id IN (SELECT rowid FROM clients_fts WHERE clients_fts MATCH ?)",
                Value::Text(q),
            ),
            None => c.add_many(
                "(c.full_name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')".into(),
                {
                    let pattern = query::like_pattern(search);
                    vec![Value::Text(pattern.clone()), Value::Text(pattern)]
                },
            ),
        }
    }

    if let Some(city) = blank_to_none(filter.city.clone()) {
        c.add("c.city = ?", Value::Text(city));
    }
    if let Some(state) = blank_to_none(filter.state.clone()) {
        c.add("c.state = ?", Value::Text(state));
    }
    if let Some(category) = blank_to_none(filter.category.clone()) {
        c.add(
            "EXISTS (SELECT 1 FROM policies p WHERE p.client_id = c.id AND p.category = ?)",
            Value::Text(category),
        );
    }
    if filter.missing_email.unwrap_or(false) {
        c.add_raw("(c.email IS NULL OR c.email = '')");
    }

    c
}

pub fn list(conn: &Connection, filter: &ClientFilter) -> AppResult<Page<Client>> {
    let conditions = build_conditions(filter);
    let where_sql = conditions.where_sql();

    let total = super::count(
        conn,
        &format!("SELECT COUNT(*) FROM clients c{where_sql}"),
        conditions.params(),
    )?;

    let (page, page_size, limit, offset) = query::paginate(filter.page, filter.page_size);
    let order = query::order_by(
        filter.sort.as_deref(),
        filter.descending.unwrap_or(false),
        SORTABLE,
        "c.full_name",
    );

    let sql = format!(
        "SELECT {CLIENT_COLUMNS}, {DERIVED} FROM clients c{where_sql}{order} LIMIT ? OFFSET ?"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(
            params_from_iter(conditions.params_with([limit, offset])),
            Client::from_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(Page {
        rows,
        total,
        page,
        page_size,
    })
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Client> {
    let sql = format!("SELECT {CLIENT_COLUMNS}, {DERIVED} FROM clients c WHERE c.id = ?");
    conn.query_row(&sql, params![id], Client::from_row)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound("Client"),
            other => other.into(),
        })
}

pub fn next_client_code(conn: &Connection) -> AppResult<String> {
    let next: i64 = conn.query_row(
        "SELECT IFNULL(MAX(CAST(substr(client_code, 4) AS INTEGER)), 0) + 1 \
         FROM clients WHERE client_code GLOB 'CL-[0-9]*'",
        [],
        |row| row.get(0),
    )?;
    Ok(format!("CL-{next:05}"))
}

fn validate(input: &ClientInput) -> AppResult<()> {
    if input.full_name.trim().is_empty() {
        return Err(AppError::validation("Client name is required"));
    }
    if let Some(email) = blank_to_none(input.email.clone()) {
        if !util::looks_like_email(&email) {
            return Err(AppError::validation(format!(
                "\"{email}\" is not a valid email address"
            )));
        }
    }
    if let Some(dob) = blank_to_none(input.date_of_birth.clone()) {
        if util::parse_date(&dob).is_none() {
            return Err(AppError::validation("Date of birth is not a valid date"));
        }
    }
    Ok(())
}

pub fn create(conn: &Connection, input: &ClientInput) -> AppResult<i64> {
    validate(input)?;

    let code = match blank_to_none(input.client_code.clone()) {
        Some(code) => code,
        None => next_client_code(conn)?,
    };

    conn.execute(
        "INSERT INTO clients (client_code, full_name, email, phone, alt_phone, date_of_birth, \
             gender, address_line1, address_line2, city, state, pincode, occupation, pan, gstin, \
             preferred_language, reminders_opted_out, notes) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        params![
            code,
            util::tidy_name(&input.full_name),
            blank_to_none(input.email.clone()),
            input.phone.as_deref().and_then(util::normalise_phone),
            input.alt_phone.as_deref().and_then(util::normalise_phone),
            blank_to_none(input.date_of_birth.clone()).and_then(|d| util::parse_date(&d)),
            blank_to_none(input.gender.clone()),
            blank_to_none(input.address_line1.clone()),
            blank_to_none(input.address_line2.clone()),
            blank_to_none(input.city.clone()),
            blank_to_none(input.state.clone()),
            blank_to_none(input.pincode.clone()),
            blank_to_none(input.occupation.clone()),
            blank_to_none(input.pan.clone()).map(|p| p.to_uppercase()),
            blank_to_none(input.gstin.clone()).map(|g| g.to_uppercase()),
            input
                .preferred_language
                .clone()
                .unwrap_or_else(|| "en".into()),
            input.reminders_opted_out.unwrap_or(false) as i64,
            blank_to_none(input.notes.clone()),
        ],
    )
    .map_err(map_unique_error)?;

    Ok(conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: &ClientInput) -> AppResult<()> {
    validate(input)?;

    let changed = conn
        .execute(
            "UPDATE clients SET full_name = ?2, email = ?3, phone = ?4, alt_phone = ?5, \
                 date_of_birth = ?6, gender = ?7, address_line1 = ?8, address_line2 = ?9, \
                 city = ?10, state = ?11, pincode = ?12, occupation = ?13, pan = ?14, gstin = ?15, \
                 preferred_language = ?16, reminders_opted_out = ?17, notes = ?18, \
                 client_code = COALESCE(?19, client_code) \
             WHERE id = ?1",
            params![
                id,
                util::tidy_name(&input.full_name),
                blank_to_none(input.email.clone()),
                input.phone.as_deref().and_then(util::normalise_phone),
                input.alt_phone.as_deref().and_then(util::normalise_phone),
                blank_to_none(input.date_of_birth.clone()).and_then(|d| util::parse_date(&d)),
                blank_to_none(input.gender.clone()),
                blank_to_none(input.address_line1.clone()),
                blank_to_none(input.address_line2.clone()),
                blank_to_none(input.city.clone()),
                blank_to_none(input.state.clone()),
                blank_to_none(input.pincode.clone()),
                blank_to_none(input.occupation.clone()),
                blank_to_none(input.pan.clone()).map(|p| p.to_uppercase()),
                blank_to_none(input.gstin.clone()).map(|g| g.to_uppercase()),
                input
                    .preferred_language
                    .clone()
                    .unwrap_or_else(|| "en".into()),
                input.reminders_opted_out.unwrap_or(false) as i64,
                blank_to_none(input.notes.clone()),
                blank_to_none(input.client_code.clone()),
            ],
        )
        .map_err(map_unique_error)?;

    if changed == 0 {
        return Err(AppError::NotFound("Client"));
    }
    Ok(())
}

pub fn set_archived(conn: &Connection, id: i64, archived: bool) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE clients SET is_archived = ?2 WHERE id = ?1",
        params![id, archived as i64],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("Client"));
    }
    Ok(())
}

/// Removes the client together with their policies. The UI confirms first; the
/// archive flag is the softer option offered alongside it.
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM clients WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound("Client"));
    }
    Ok(())
}

pub fn distinct_cities(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT city FROM clients WHERE city IS NOT NULL AND city <> '' ORDER BY city",
    )?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Finds an existing client by code, then email, then name — used by the importer
/// to decide between updating and inserting.
pub fn find_match(
    conn: &Connection,
    code: Option<&str>,
    email: Option<&str>,
    phone: Option<&str>,
    name: &str,
) -> AppResult<Option<i64>> {
    if let Some(code) = code.filter(|c| !c.is_empty()) {
        if let Some(id) = lookup(conn, "SELECT id FROM clients WHERE client_code = ?1", code)? {
            return Ok(Some(id));
        }
    }
    if let Some(email) = email.filter(|e| !e.is_empty()) {
        if let Some(id) = lookup(
            conn,
            "SELECT id FROM clients WHERE lower(email) = lower(?1)",
            email,
        )? {
            return Ok(Some(id));
        }
    }
    if let Some(phone) = phone.filter(|p| !p.is_empty()) {
        if let Some(id) = lookup(conn, "SELECT id FROM clients WHERE phone = ?1", phone)? {
            return Ok(Some(id));
        }
    }
    lookup(
        conn,
        "SELECT id FROM clients WHERE lower(full_name) = lower(?1)",
        name,
    )
}

fn lookup(conn: &Connection, sql: &str, value: &str) -> AppResult<Option<i64>> {
    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query(params![value])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

fn map_unique_error(err: rusqlite::Error) -> AppError {
    match &err {
        rusqlite::Error::SqliteFailure(e, Some(msg))
            if e.code == rusqlite::ErrorCode::ConstraintViolation
                && msg.contains("client_code") =>
        {
            AppError::Conflict("That client code is already in use".into())
        }
        _ => err.into(),
    }
}
