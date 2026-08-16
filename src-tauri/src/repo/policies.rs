use rusqlite::{params, params_from_iter, types::Value, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{
    blank_to_none, Page, Policy, PolicyFilter, PolicyInput, RenewalInput, POLICY_COLUMNS,
};
use crate::query::{self, Conditions};
use crate::util;

const STATUSES: &[&str] = &["active", "expired", "renewed", "lapsed", "cancelled"];

const SORTABLE: &[(&str, &str)] = &[
    ("expiry", "expiry_date"),
    ("days", "days_to_expiry"),
    ("client", "client_name"),
    ("premium", "premium_amount"),
    ("sumInsured", "sum_insured"),
    ("insurer", "insurer_name"),
    ("category", "category"),
    ("policyNumber", "policy_number"),
    ("created", "created_at"),
];

/// Days after expiry with no renewal before a policy is treated as lapsed.
const LAPSE_GRACE_DAYS: i64 = 30;

fn build_conditions(filter: &PolicyFilter) -> Conditions {
    let mut c = Conditions::new();

    if let Some(search) = filter
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let pattern = query::like_pattern(search);
        c.add_many(
            "(policy_number LIKE ? ESCAPE '\\' OR client_name LIKE ? ESCAPE '\\' \
              OR client_code LIKE ? ESCAPE '\\' OR vehicle_number LIKE ? ESCAPE '\\')"
                .into(),
            std::iter::repeat_n(Value::Text(pattern), 4),
        );
    }

    if let Some(client_id) = filter.client_id {
        c.add("client_id = ?", Value::Integer(client_id));
    }
    if let Some(insurer_id) = filter.insurer_id {
        c.add("insurer_id = ?", Value::Integer(insurer_id));
    }
    if let Some(product_id) = filter.product_id {
        c.add("product_id = ?", Value::Integer(product_id));
    }

    if let Some(categories) = filter.categories.as_ref() {
        if let Some((clause, values)) = query::in_clause("category", categories, util::CATEGORIES) {
            c.add_many(clause, values);
        }
    }
    if let Some(statuses) = filter.statuses.as_ref() {
        if let Some((clause, values)) = query::in_clause("status", statuses, STATUSES) {
            c.add_many(clause, values);
        }
    }

    if let Some(from) = blank_to_none(filter.expiry_from.clone()).and_then(|d| util::parse_date(&d))
    {
        c.add("expiry_date >= ?", Value::Text(from));
    }
    if let Some(to) = blank_to_none(filter.expiry_to.clone()).and_then(|d| util::parse_date(&d)) {
        c.add("expiry_date <= ?", Value::Text(to));
    }
    if let Some(days) = filter.expiring_within_days {
        c.add_raw("days_to_expiry >= 0");
        c.add("days_to_expiry <= ?", Value::Integer(days));
    }
    if let Some(min) = filter.min_premium {
        c.add("IFNULL(premium_amount, 0) >= ?", Value::Real(min));
    }
    if let Some(max) = filter.max_premium {
        c.add("IFNULL(premium_amount, 0) <= ?", Value::Real(max));
    }
    if let Some(city) = blank_to_none(filter.city.clone()) {
        c.add("client_city = ?", Value::Text(city));
    }
    if filter.latest_only.unwrap_or(false) {
        c.add_raw("is_renewed = 0");
    }
    if filter.unrenewed_only.unwrap_or(false) {
        c.add_raw("is_renewed = 0 AND status IN ('expired', 'lapsed')");
    }

    c
}

pub fn list(conn: &Connection, filter: &PolicyFilter) -> AppResult<Page<Policy>> {
    let conditions = build_conditions(filter);
    let where_sql = conditions.where_sql();

    let total = super::count(
        conn,
        &format!("SELECT COUNT(*) FROM policy_overview{where_sql}"),
        conditions.params(),
    )?;

    let (page, page_size, limit, offset) = query::paginate(filter.page, filter.page_size);
    let order = query::order_by(
        filter.sort.as_deref(),
        filter.descending.unwrap_or(false),
        SORTABLE,
        "expiry_date",
    );

    let sql =
        format!("SELECT {POLICY_COLUMNS} FROM policy_overview{where_sql}{order} LIMIT ? OFFSET ?");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(
            params_from_iter(conditions.params_with([limit, offset])),
            Policy::from_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(Page {
        rows,
        total,
        page,
        page_size,
    })
}

/// Every row matching the filter, ignoring pagination. Used by exports.
pub fn list_all(conn: &Connection, filter: &PolicyFilter) -> AppResult<Vec<Policy>> {
    let conditions = build_conditions(filter);
    let order = query::order_by(
        filter.sort.as_deref(),
        filter.descending.unwrap_or(false),
        SORTABLE,
        "expiry_date",
    );
    let sql = format!(
        "SELECT {POLICY_COLUMNS} FROM policy_overview{}{order}",
        conditions.where_sql()
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params_from_iter(conditions.params()), Policy::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Policy> {
    let sql = format!("SELECT {POLICY_COLUMNS} FROM policy_overview WHERE id = ?1");
    conn.query_row(&sql, params![id], Policy::from_row)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound("Policy"),
            other => other.into(),
        })
}

/// The full renewal chain a policy belongs to, oldest year first.
pub fn chain(conn: &Connection, policy_id: i64) -> AppResult<Vec<Policy>> {
    let sql = format!(
        "SELECT {POLICY_COLUMNS} FROM policy_overview \
         WHERE chain_id = (SELECT chain_id FROM policies WHERE id = ?1) \
         ORDER BY policy_year ASC, start_date ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![policy_id], Policy::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if rows.is_empty() {
        return Err(AppError::NotFound("Policy"));
    }
    Ok(rows)
}

fn validate(input: &PolicyInput) -> AppResult<(String, String)> {
    if input.policy_number.trim().is_empty() {
        return Err(AppError::validation("Policy number is required"));
    }
    if !util::CATEGORIES.contains(&input.category.as_str()) {
        return Err(AppError::validation(format!(
            "\"{}\" is not a known policy category",
            input.category
        )));
    }
    let start = util::parse_date(&input.start_date)
        .ok_or_else(|| AppError::validation("Start date is not a valid date"))?;
    let expiry = util::parse_date(&input.expiry_date)
        .ok_or_else(|| AppError::validation("Expiry date is not a valid date"))?;
    if expiry <= start {
        return Err(AppError::validation(
            "Expiry date must be after the start date",
        ));
    }
    Ok((start, expiry))
}

pub fn create(conn: &Connection, input: &PolicyInput) -> AppResult<i64> {
    let (start, expiry) = validate(input)?;
    let chain_id = uuid::Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO policies (chain_id, policy_year, policy_number, client_id, insurer_id, \
             product_id, category, status, start_date, expiry_date, sum_insured, premium_amount, \
             gst_amount, premium_frequency, payment_mode, next_due_date, commission_rate, \
             commission_expected, nominee_name, nominee_relation, vehicle_number, notes) \
         VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, \
             ?18, ?19, ?20, ?21)",
        params![
            chain_id,
            input.policy_number.trim(),
            input.client_id,
            input.insurer_id,
            input.product_id,
            input.category,
            input.status.clone().unwrap_or_else(|| "active".into()),
            start,
            expiry,
            input.sum_insured,
            input.premium_amount,
            input.gst_amount,
            input
                .premium_frequency
                .clone()
                .unwrap_or_else(|| "annual".into()),
            blank_to_none(input.payment_mode.clone()),
            blank_to_none(input.next_due_date.clone()).and_then(|d| util::parse_date(&d)),
            input.commission_rate,
            input.commission_expected,
            blank_to_none(input.nominee_name.clone()),
            blank_to_none(input.nominee_relation.clone()),
            blank_to_none(input.vehicle_number.clone()).map(|v| v.to_uppercase()),
            blank_to_none(input.notes.clone()),
        ],
    )
    .map_err(map_constraint_error)?;

    let id = conn.last_insert_rowid();
    set_members(conn, id, input.member_ids.as_deref().unwrap_or(&[]))?;
    Ok(id)
}

pub fn update(conn: &Connection, id: i64, input: &PolicyInput) -> AppResult<()> {
    let (start, expiry) = validate(input)?;

    let changed = conn
        .execute(
            "UPDATE policies SET policy_number = ?2, client_id = ?3, insurer_id = ?4, \
                 product_id = ?5, category = ?6, status = COALESCE(?7, status), start_date = ?8, \
                 expiry_date = ?9, sum_insured = ?10, premium_amount = ?11, gst_amount = ?12, \
                 premium_frequency = ?13, payment_mode = ?14, next_due_date = ?15, \
                 commission_rate = ?16, commission_expected = ?17, nominee_name = ?18, \
                 nominee_relation = ?19, vehicle_number = ?20, notes = ?21 \
             WHERE id = ?1",
            params![
                id,
                input.policy_number.trim(),
                input.client_id,
                input.insurer_id,
                input.product_id,
                input.category,
                input.status,
                start,
                expiry,
                input.sum_insured,
                input.premium_amount,
                input.gst_amount,
                input
                    .premium_frequency
                    .clone()
                    .unwrap_or_else(|| "annual".into()),
                blank_to_none(input.payment_mode.clone()),
                blank_to_none(input.next_due_date.clone()).and_then(|d| util::parse_date(&d)),
                input.commission_rate,
                input.commission_expected,
                blank_to_none(input.nominee_name.clone()),
                blank_to_none(input.nominee_relation.clone()),
                blank_to_none(input.vehicle_number.clone()).map(|v| v.to_uppercase()),
                blank_to_none(input.notes.clone()),
            ],
        )
        .map_err(map_constraint_error)?;

    if changed == 0 {
        return Err(AppError::NotFound("Policy"));
    }
    if let Some(members) = input.member_ids.as_deref() {
        set_members(conn, id, members)?;
    }
    Ok(())
}

/// Adds the next year to a chain. Values not supplied are carried forward from
/// the policy being renewed, and the previous year is marked as renewed rather
/// than overwritten.
pub fn renew(conn: &Connection, input: &RenewalInput) -> AppResult<i64> {
    let previous = get(conn, input.policy_id)?;

    // One open year to a chain. Nothing but the interface's own buttons kept a
    // year from being renewed twice, and a second successor would leave the
    // chain forking with two open years and the desk showing both.
    if previous.is_renewed {
        return Err(AppError::Conflict(
            "That year has already been renewed. Renew the latest year instead.".into(),
        ));
    }

    let start = match blank_to_none(input.start_date.clone()).and_then(|d| util::parse_date(&d)) {
        Some(date) => date,
        None => {
            let day_after = chrono::NaiveDate::parse_from_str(&previous.expiry_date, "%Y-%m-%d")
                .map_err(|_| AppError::other("stored expiry date is unreadable"))?
                + chrono::Duration::days(1);
            util::iso(day_after)
        }
    };
    let expiry = match blank_to_none(input.expiry_date.clone()).and_then(|d| util::parse_date(&d)) {
        Some(date) => date,
        None => util::default_expiry(&start)
            .ok_or_else(|| AppError::other("could not work out the new expiry date"))?,
    };
    if expiry <= start {
        return Err(AppError::validation(
            "Expiry date must be after the start date",
        ));
    }

    let policy_number = blank_to_none(input.policy_number.clone())
        .unwrap_or_else(|| previous.policy_number.clone());

    conn.execute(
        "INSERT INTO policies (chain_id, policy_year, previous_policy_id, policy_number, client_id, \
             insurer_id, product_id, category, status, start_date, expiry_date, sum_insured, \
             premium_amount, gst_amount, premium_frequency, payment_mode, commission_rate, \
             commission_expected, nominee_name, nominee_relation, vehicle_number, notes) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, \
             ?17, ?18, ?19, ?20, ?21)",
        params![
            previous.chain_id,
            previous.policy_year + 1,
            previous.id,
            policy_number,
            previous.client_id,
            previous.insurer_id,
            previous.product_id,
            previous.category,
            start,
            expiry,
            input.sum_insured.or(previous.sum_insured),
            input.premium_amount.or(previous.premium_amount),
            input.gst_amount.or(previous.gst_amount),
            previous.premium_frequency,
            previous.payment_mode,
            input.commission_rate.or(previous.commission_rate),
            input.commission_expected.or(previous.commission_expected),
            previous.nominee_name,
            previous.nominee_relation,
            previous.vehicle_number,
            blank_to_none(input.notes.clone()),
        ],
    )
    .map_err(map_constraint_error)?;

    let new_id = conn.last_insert_rowid();

    conn.execute(
        "INSERT INTO policy_members (policy_id, member_id) \
         SELECT ?1, member_id FROM policy_members WHERE policy_id = ?2",
        params![new_id, previous.id],
    )?;
    // A cancelled year keeps saying so. Cancelling is something the agent did
    // and the client agreed to; writing 'renewed' over it would leave the book
    // unable to say the cover was ever ended early. The year is still marked
    // renewed for every purpose that matters, because `is_renewed` reads the
    // successor rather than the status.
    conn.execute(
        "UPDATE policies SET status = 'renewed' WHERE id = ?1 AND status <> 'cancelled'",
        params![previous.id],
    )?;

    // A client who has just renewed should not receive this morning's queued
    // "your policy is about to expire" message this evening.
    super::notifications::cancel_for_policy(conn, previous.id)?;

    Ok(new_id)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM policies WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound("Policy"));
    }
    Ok(())
}

pub fn set_status(conn: &Connection, id: i64, status: &str) -> AppResult<()> {
    if !STATUSES.contains(&status) {
        return Err(AppError::validation(format!(
            "\"{status}\" is not a valid status"
        )));
    }
    let changed = conn.execute(
        "UPDATE policies SET status = ?2 WHERE id = ?1",
        params![id, status],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("Policy"));
    }
    Ok(())
}

pub fn set_members(conn: &Connection, policy_id: i64, member_ids: &[i64]) -> AppResult<()> {
    conn.execute(
        "DELETE FROM policy_members WHERE policy_id = ?1",
        params![policy_id],
    )?;
    let mut stmt = conn.prepare(
        "INSERT OR IGNORE INTO policy_members (policy_id, member_id) \
         SELECT ?1, id FROM insured_members WHERE id = ?2 \
           AND client_id = (SELECT client_id FROM policies WHERE id = ?1)",
    )?;
    for member_id in member_ids {
        stmt.execute(params![policy_id, member_id])?;
    }
    Ok(())
}

pub fn members_of(conn: &Connection, policy_id: i64) -> AppResult<Vec<i64>> {
    let mut stmt = conn
        .prepare("SELECT member_id FROM policy_members WHERE policy_id = ?1 ORDER BY member_id")?;
    let rows = stmt
        .query_map(params![policy_id], |row| row.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Brings statuses in line with the calendar. Runs on unlock and before every
/// reminder sweep so that "expiring" and "lapsed" always mean what they say.
pub fn sync_statuses(conn: &Connection) -> AppResult<usize> {
    let mut touched = 0;

    // A policy with a successor is renewed, whatever it said before.
    touched += conn.execute(
        "UPDATE policies SET status = 'renewed' \
         WHERE status IN ('active', 'expired', 'lapsed') \
           AND EXISTS (SELECT 1 FROM policies s WHERE s.previous_policy_id = policies.id)",
        [],
    )?;

    // And one without a successor is not, however it came to say so: deleting
    // the year that replaced it puts it back at the head of its chain, where
    // the statements below read the calendar for it like any other open year.
    touched += conn.execute(
        "UPDATE policies SET status = 'active' \
         WHERE status = 'renewed' \
           AND NOT EXISTS (SELECT 1 FROM policies s WHERE s.previous_policy_id = policies.id)",
        [],
    )?;

    touched += conn.execute(
        "UPDATE policies SET status = 'expired' \
         WHERE status = 'active' AND expiry_date < date('now', 'localtime') \
           AND NOT EXISTS (SELECT 1 FROM policies s WHERE s.previous_policy_id = policies.id)",
        [],
    )?;

    touched += conn.execute(
        &format!(
            "UPDATE policies SET status = 'lapsed' \
             WHERE status = 'expired' \
               AND julianday(date('now', 'localtime')) - julianday(expiry_date) > {LAPSE_GRACE_DAYS} \
               AND NOT EXISTS (SELECT 1 FROM policies s WHERE s.previous_policy_id = policies.id)"
        ),
        [],
    )?;

    // Correction path: a back-dated expiry edit can make an expired policy current again.
    touched += conn.execute(
        "UPDATE policies SET status = 'active' \
         WHERE status IN ('expired', 'lapsed') AND expiry_date >= date('now', 'localtime') \
           AND NOT EXISTS (SELECT 1 FROM policies s WHERE s.previous_policy_id = policies.id)",
        [],
    )?;

    Ok(touched)
}

fn map_constraint_error(err: rusqlite::Error) -> AppError {
    match &err {
        rusqlite::Error::SqliteFailure(e, Some(msg))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            if msg.contains("policies.policy_number") || msg.contains("insurer_id, policy_number") {
                AppError::Conflict(
                    "That policy number already exists for this insurer. Use Renew to add the next year."
                        .into(),
                )
            } else if msg.contains("FOREIGN KEY") {
                AppError::validation("Pick an existing client and insurer for this policy")
            } else {
                AppError::Conflict(msg.clone())
            }
        }
        _ => err.into(),
    }
}
