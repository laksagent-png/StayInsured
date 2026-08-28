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

/// The years a vehicle can have been built in. The upper bound is a typo guard
/// rather than a fact about vehicles: a year typed with an extra digit would
/// otherwise sort the policy to the far end of every list that shows it. Matches
/// the `CHECK` the motor migration puts on `manufacture_year`.
const MANUFACTURE_YEARS: std::ops::RangeInclusive<i64> = 1900..=2100;

fn build_conditions(filter: &PolicyFilter) -> Conditions {
    let mut c = Conditions::new();

    if let Some(search) = filter
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let pattern = query::like_pattern(search);
        // The engine and chassis numbers are here because a motor claim arrives
        // quoting one of them and nothing else.
        c.add_many(
            "(policy_number LIKE ? ESCAPE '\\' OR client_name LIKE ? ESCAPE '\\' \
              OR client_code LIKE ? ESCAPE '\\' OR vehicle_number LIKE ? ESCAPE '\\' \
              OR engine_number LIKE ? ESCAPE '\\' OR chassis_number LIKE ? ESCAPE '\\')"
                .into(),
            std::iter::repeat_n(Value::Text(pattern), 6),
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

/// The motor columns as they will be written, once the vehicle type and the
/// cover type have decided which of them apply.
///
/// The clearing lives here rather than at the call sites so that a field the
/// answer says is not there is NULL however the policy was reached — the form,
/// an edit that changed the cover type, or an import.
#[derive(Debug, Default)]
struct Motor {
    vehicle_type: Option<String>,
    gross_vehicle_weight: Option<f64>,
    passenger_capacity: Option<i64>,
    vehicle_manufacturer: Option<String>,
    vehicle_model: Option<String>,
    manufacture_year: Option<i64>,
    engine_number: Option<String>,
    chassis_number: Option<String>,
    cover_type: Option<String>,
    od_start_date: Option<String>,
    od_end_date: Option<String>,
    tp_start_date: Option<String>,
    tp_end_date: Option<String>,
    od_premium: Option<f64>,
    tp_premium: Option<f64>,
}

impl Motor {
    /// The period the policy actually runs for: the earliest cover to start and
    /// the earliest to end, so the renewals desk chases whichever half lapses
    /// first. `None` when neither applicable cover has a complete period, which
    /// leaves the dates the caller supplied standing.
    ///
    /// The pair cannot come out backwards: the earliest end belongs to some
    /// period whose own start is at or after the earliest start, and every
    /// period here has already been checked for ending after it starts.
    fn risk_period(&self) -> Option<(String, String)> {
        let start = [&self.od_start_date, &self.tp_start_date]
            .into_iter()
            .flatten()
            .min()?;
        let end = [&self.od_end_date, &self.tp_end_date]
            .into_iter()
            .flatten()
            .min()?;
        Some((start.clone(), end.clone()))
    }
}

/// Reads one of the four risk dates. A cover the policy does not carry has no
/// dates at all, so what was sent for it is dropped rather than read: an edit
/// from a bundle to a liability policy is not refused for the own damage dates
/// it is on its way to losing.
fn risk_date(raw: &Option<String>, applies: bool, what: &str) -> AppResult<Option<String>> {
    if !applies {
        return Ok(None);
    }
    match blank_to_none(raw.clone()) {
        None => Ok(None),
        Some(text) => util::parse_date(&text)
            .map(Some)
            .ok_or_else(|| AppError::validation(format!("{what} is not a valid date"))),
    }
}

/// A risk period is complete or absent, and runs forwards. Equal dates are an
/// error for the same reason `start_date` and `expiry_date` refuse them: a
/// cover that ends the day it starts covered nothing.
fn check_risk_period(
    start: &Option<String>,
    end: &Option<String>,
    both: &str,
    order: &str,
) -> AppResult<()> {
    match (start, end) {
        (Some(from), Some(to)) if to <= from => Err(AppError::validation(order)),
        (Some(_), None) | (None, Some(_)) => Err(AppError::validation(both)),
        _ => Ok(()),
    }
}

fn motor_detail(input: &PolicyInput) -> AppResult<Motor> {
    let vehicle_type = blank_to_none(input.vehicle_type.clone());
    check_word("vehicle type", vehicle_type.as_deref(), util::VEHICLE_TYPES)?;
    let cover_type = blank_to_none(input.cover_type.clone());
    check_word("cover type", cover_type.as_deref(), util::COVER_TYPES)?;

    let own_damage = util::cover_has_own_damage(cover_type.as_deref());
    let third_party = util::cover_has_third_party(cover_type.as_deref());

    let od_start_date = risk_date(&input.od_start_date, own_damage, "Own damage start date")?;
    let od_end_date = risk_date(&input.od_end_date, own_damage, "Own damage end date")?;
    let tp_start_date = risk_date(&input.tp_start_date, third_party, "Third party start date")?;
    let tp_end_date = risk_date(&input.tp_end_date, third_party, "Third party end date")?;

    check_risk_period(
        &od_start_date,
        &od_end_date,
        "Both risk dates are needed for own damage cover",
        "The own damage cover must end after it starts",
    )?;
    check_risk_period(
        &tp_start_date,
        &tp_end_date,
        "Both risk dates are needed for third party cover",
        "The third party cover must end after it starts",
    )?;

    Ok(Motor {
        gross_vehicle_weight: match vehicle_type.as_deref() {
            Some("goods_carrying") => input.gross_vehicle_weight,
            _ => None,
        },
        passenger_capacity: match vehicle_type.as_deref() {
            Some("passenger") => input.passenger_capacity,
            _ => None,
        },
        vehicle_type,
        vehicle_manufacturer: blank_to_none(input.vehicle_manufacturer.clone()),
        vehicle_model: blank_to_none(input.vehicle_model.clone()),
        manufacture_year: input.manufacture_year,
        engine_number: blank_to_none(input.engine_number.clone()).map(|v| v.to_uppercase()),
        chassis_number: blank_to_none(input.chassis_number.clone()).map(|v| v.to_uppercase()),
        cover_type,
        od_start_date,
        od_end_date,
        tp_start_date,
        tp_end_date,
        od_premium: own_damage.then_some(input.od_premium).flatten(),
        tp_premium: third_party.then_some(input.tp_premium).flatten(),
    })
}

fn validate(input: &PolicyInput) -> AppResult<(String, String, Motor)> {
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

    // The health details are checked for being words the app knows, not for
    // being there at all. Requiring them belongs to the add-policy screen: an
    // import carries a book that predates the questions, and refusing it here
    // would lose the policy rather than the detail.
    check_word("plan type", input.plan_type.as_deref(), util::PLAN_TYPES)?;
    check_word(
        "policy type",
        input.policy_type.as_deref(),
        util::POLICY_TYPES,
    )?;
    for rider in input.riders.as_deref().unwrap_or_default() {
        check_word("rider", Some(rider.as_str()), util::RIDERS)?;
    }
    if let Some(term) = input.term {
        if !(1..=util::MAX_TERM).contains(&term) {
            return Err(AppError::validation(format!(
                "A term is between 1 and {} years",
                util::MAX_TERM
            )));
        }
    }

    let motor = motor_detail(input)?;

    // The schema holds these same three bounds, but a CHECK firing reaches the
    // caller as a constraint message naming a column, which is not something to
    // put in front of an operator. Saying the limits here in words leaves the
    // schema as the backstop rather than the thing anybody meets.
    //
    // They are read off the detail rather than off the input, so that they are
    // asked only of the answers that survived: a lorry corrected to a private
    // car has already had its weight dropped, and should not be refused for a
    // figure it is on its way to discarding.
    if motor
        .manufacture_year
        .is_some_and(|year| !MANUFACTURE_YEARS.contains(&year))
    {
        return Err(AppError::validation(
            "A manufacture year is between 1900 and 2100",
        ));
    }
    if motor.gross_vehicle_weight.is_some_and(|kg| kg <= 0.0) {
        return Err(AppError::validation(
            "A gross vehicle weight is more than nothing",
        ));
    }
    if motor.passenger_capacity.is_some_and(|seats| seats < 1) {
        return Err(AppError::validation(
            "A vehicle carries at least one passenger",
        ));
    }

    // A motor year runs for as long as its first cover does. A 1+3 bundle whose
    // own damage has to be bought again after a year is a policy the desk needs
    // to see next spring, not in three years' time.
    match motor.risk_period() {
        Some((from, to)) if input.category == "motor" => Ok((from, to, motor)),
        _ => Ok((start, expiry, motor)),
    }
}

/// Holds a value to a fixed vocabulary. Nothing at all is allowed: these fields
/// describe health cover, and every other category leaves them empty.
fn check_word(what: &str, value: Option<&str>, allowed: &[&str]) -> AppResult<()> {
    match value {
        Some(word) if !allowed.contains(&word) => Err(AppError::validation(format!(
            "\"{word}\" is not a known {what}"
        ))),
        _ => Ok(()),
    }
}

pub fn create(conn: &Connection, input: &PolicyInput) -> AppResult<i64> {
    let (start, expiry, motor) = validate(input)?;
    let chain_id = uuid::Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO policies (chain_id, policy_year, policy_number, client_id, insurer_id, \
             product_id, category, status, start_date, expiry_date, sum_insured, premium_amount, \
             gst_amount, premium_frequency, payment_mode, next_due_date, commission_rate, \
             commission_expected, nominee_name, nominee_relation, vehicle_number, variant, \
             riders, plan_type, term, policy_type, broker, inbuilt_rider, vehicle_type, \
             gross_vehicle_weight, passenger_capacity, vehicle_manufacturer, vehicle_model, \
             manufacture_year, engine_number, chassis_number, cover_type, od_start_date, \
             od_end_date, tp_start_date, tp_end_date, od_premium, tp_premium, notes) \
         VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, \
             ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, \
             ?34, ?35, ?36, ?37, ?38, ?39, ?40, ?41, ?42, ?43)",
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
            blank_to_none(input.variant.clone()),
            util::canonical_riders(input.riders.as_deref().unwrap_or_default()),
            blank_to_none(input.plan_type.clone()),
            input.term,
            blank_to_none(input.policy_type.clone()),
            blank_to_none(input.broker.clone()),
            blank_to_none(input.inbuilt_rider.clone()),
            motor.vehicle_type,
            motor.gross_vehicle_weight,
            motor.passenger_capacity,
            motor.vehicle_manufacturer,
            motor.vehicle_model,
            motor.manufacture_year,
            motor.engine_number,
            motor.chassis_number,
            motor.cover_type,
            motor.od_start_date,
            motor.od_end_date,
            motor.tp_start_date,
            motor.tp_end_date,
            motor.od_premium,
            motor.tp_premium,
            blank_to_none(input.notes.clone()),
        ],
    )
    .map_err(map_constraint_error)?;

    let id = conn.last_insert_rowid();
    set_members(conn, id, input.insured_client_ids.as_deref().unwrap_or(&[]))?;
    Ok(id)
}

pub fn update(conn: &Connection, id: i64, input: &PolicyInput) -> AppResult<()> {
    let (start, expiry, motor) = validate(input)?;

    let changed = conn
        .execute(
            "UPDATE policies SET policy_number = ?2, client_id = ?3, insurer_id = ?4, \
                 product_id = ?5, category = ?6, status = COALESCE(?7, status), start_date = ?8, \
                 expiry_date = ?9, sum_insured = ?10, premium_amount = ?11, gst_amount = ?12, \
                 premium_frequency = ?13, payment_mode = ?14, next_due_date = ?15, \
                 commission_rate = ?16, commission_expected = ?17, nominee_name = ?18, \
                 nominee_relation = ?19, vehicle_number = ?20, variant = ?21, riders = ?22, \
                 plan_type = ?23, term = ?24, policy_type = ?25, broker = ?26, \
                 inbuilt_rider = ?27, vehicle_type = ?28, gross_vehicle_weight = ?29, \
                 passenger_capacity = ?30, vehicle_manufacturer = ?31, vehicle_model = ?32, \
                 manufacture_year = ?33, engine_number = ?34, chassis_number = ?35, \
                 cover_type = ?36, od_start_date = ?37, od_end_date = ?38, tp_start_date = ?39, \
                 tp_end_date = ?40, od_premium = ?41, tp_premium = ?42, notes = ?43 \
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
                blank_to_none(input.variant.clone()),
                util::canonical_riders(input.riders.as_deref().unwrap_or_default()),
                blank_to_none(input.plan_type.clone()),
                input.term,
                blank_to_none(input.policy_type.clone()),
                blank_to_none(input.broker.clone()),
                blank_to_none(input.inbuilt_rider.clone()),
                motor.vehicle_type,
                motor.gross_vehicle_weight,
                motor.passenger_capacity,
                motor.vehicle_manufacturer,
                motor.vehicle_model,
                motor.manufacture_year,
                motor.engine_number,
                motor.chassis_number,
                motor.cover_type,
                motor.od_start_date,
                motor.od_end_date,
                motor.tp_start_date,
                motor.tp_end_date,
                motor.od_premium,
                motor.tp_premium,
                blank_to_none(input.notes.clone()),
            ],
        )
        .map_err(map_constraint_error)?;

    if changed == 0 {
        return Err(AppError::NotFound("Policy"));
    }
    if let Some(insured) = input.insured_client_ids.as_deref() {
        set_members(conn, id, insured)?;
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
        // A three-year policy renews for three years unless the agent says
        // otherwise, so the term that was bought decides the length rather than
        // the annual default.
        None => util::expiry_after(&start, previous.term.unwrap_or(1))
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
             commission_expected, nominee_name, nominee_relation, vehicle_number, variant, \
             riders, plan_type, term, policy_type, broker, inbuilt_rider, notes, vehicle_type, \
             gross_vehicle_weight, passenger_capacity, vehicle_manufacturer, vehicle_model, \
             manufacture_year, engine_number, chassis_number, cover_type) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, \
             ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, \
             ?34, ?35, ?36, ?37)",
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
            previous.variant,
            util::canonical_riders(&previous.riders),
            previous.plan_type,
            previous.term,
            // The new year is a renewal by definition, whatever the year before
            // it was. A policy ported in last August is a renewal this August,
            // and the year that was ported keeps saying so.
            previous.policy_type.map(|_| "renewal".to_string()),
            previous.broker,
            previous.inbuilt_rider,
            blank_to_none(input.notes.clone()),
            // The vehicle comes along; the risk periods and the split premiums
            // do not, because they describe the year being renewed. The new
            // year's own dates and premiums are filled in by editing it.
            previous.vehicle_type,
            previous.gross_vehicle_weight,
            previous.passenger_capacity,
            previous.vehicle_manufacturer,
            previous.vehicle_model,
            previous.manufacture_year,
            previous.engine_number,
            previous.chassis_number,
            previous.cover_type,
        ],
    )
    .map_err(map_constraint_error)?;

    let new_id = conn.last_insert_rowid();

    conn.execute(
        "INSERT INTO policy_members (policy_id, insured_client_id) \
         SELECT ?1, insured_client_id FROM policy_members WHERE policy_id = ?2",
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

/// Replaces the list of clients a policy year covers.
///
/// A client may be attached when they are the policyholder or when the book
/// records how they are related to them. The rule lives in the insert rather than
/// in the interface: a floater is the one place where a stray id would put a
/// stranger's name and date of birth onto somebody else's cover, and an import
/// reaches this code without passing a screen at all.
pub fn set_members(conn: &Connection, policy_id: i64, insured_client_ids: &[i64]) -> AppResult<()> {
    conn.execute(
        "DELETE FROM policy_members WHERE policy_id = ?1",
        params![policy_id],
    )?;
    let mut stmt = conn.prepare(
        "INSERT OR IGNORE INTO policy_members (policy_id, insured_client_id) \
         SELECT ?1, c.id FROM clients c WHERE c.id = ?2 AND ( \
              c.id = (SELECT client_id FROM policies WHERE id = ?1) \
           OR EXISTS (SELECT 1 FROM client_relations r \
                       WHERE (r.client_id = (SELECT client_id FROM policies WHERE id = ?1) \
                              AND r.related_client_id = c.id) \
                          OR (r.related_client_id = (SELECT client_id FROM policies WHERE id = ?1) \
                              AND r.client_id = c.id)))",
    )?;
    for client_id in insured_client_ids {
        stmt.execute(params![policy_id, client_id])?;
    }
    Ok(())
}

/// The clients a policy year covers.
pub fn insured_of(conn: &Connection, policy_id: i64) -> AppResult<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT insured_client_id FROM policy_members WHERE policy_id = ?1 \
         ORDER BY insured_client_id",
    )?;
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
