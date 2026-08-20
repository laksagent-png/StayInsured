use rusqlite::{params, Connection};

use crate::error::AppResult;
use crate::models::{CategoryBreakdown, Dashboard, ExpiryBucket, Policy, POLICY_COLUMNS};

/// Windows the renewal desk works in, in days from today.
const BUCKETS: &[(&str, i64, i64)] = &[
    ("Overdue", -3_650, -1),
    ("0-7 days", 0, 7),
    ("8-15 days", 8, 15),
    ("16-30 days", 16, 30),
    ("31-60 days", 31, 60),
    ("61-90 days", 61, 90),
];

pub fn load(conn: &Connection) -> AppResult<Dashboard> {
    let scalar = |sql: &str| -> AppResult<i64> { Ok(conn.query_row(sql, [], |row| row.get(0))?) };
    let money = |sql: &str| -> AppResult<f64> { Ok(conn.query_row(sql, [], |row| row.get(0))?) };

    let mut buckets = Vec::new();
    for (label, from, to) in BUCKETS {
        // Everything past expiry only counts while it is still unrenewed.
        let extra = if *to < 0 {
            " AND is_renewed = 0 AND status <> 'cancelled'"
        } else {
            " AND status = 'active'"
        };
        let (count, premium) = conn.query_row(
            &format!(
                "SELECT COUNT(*), IFNULL(SUM(premium_amount), 0) FROM policy_overview \
                 WHERE days_to_expiry BETWEEN ?1 AND ?2{extra}"
            ),
            params![from, to],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?)),
        )?;
        buckets.push(ExpiryBucket {
            label: (*label).to_string(),
            count,
            premium_total: premium,
        });
    }

    let mut stmt = conn.prepare(
        "SELECT category, COUNT(*), IFNULL(SUM(premium_amount), 0), IFNULL(SUM(sum_insured), 0) \
         FROM policy_overview WHERE status = 'active' GROUP BY category ORDER BY COUNT(*) DESC",
    )?;
    let by_category = stmt
        .query_map([], |row| {
            Ok(CategoryBreakdown {
                category: row.get(0)?,
                policy_count: row.get(1)?,
                premium_total: row.get(2)?,
                sum_insured_total: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let upcoming = policies(
        conn,
        "WHERE status = 'active' AND days_to_expiry BETWEEN 0 AND 45 \
         ORDER BY expiry_date ASC LIMIT 12",
    )?;
    let recently_lapsed = policies(
        conn,
        "WHERE is_renewed = 0 AND status IN ('expired', 'lapsed') \
         ORDER BY expiry_date DESC LIMIT 8",
    )?;

    // The counts of people are counts of policyholders. A family member is a
    // client, so counting rows would say the book holds half again as many people
    // as it has cover for, and would report every child as a client with no email
    // address — which is the one figure on this screen meant to be acted on.
    let holders = format!(
        "FROM clients c WHERE NOT ({})",
        super::clients::IS_DEPENDENT
    );

    Ok(Dashboard {
        total_clients: scalar(&format!("SELECT COUNT(*) {holders}"))?,
        active_clients: scalar(&format!("SELECT COUNT(*) {holders} AND c.is_archived = 0"))?,
        active_policies: scalar("SELECT COUNT(*) FROM policies WHERE status = 'active'")?,
        expiring_this_week: scalar(
            "SELECT COUNT(*) FROM policy_overview \
             WHERE status = 'active' AND days_to_expiry BETWEEN 0 AND 7",
        )?,
        expiring_this_month: scalar(
            "SELECT COUNT(*) FROM policy_overview \
             WHERE status = 'active' AND days_to_expiry BETWEEN 0 AND 30",
        )?,
        expired_unrenewed: scalar(
            "SELECT COUNT(*) FROM policy_overview \
             WHERE is_renewed = 0 AND status IN ('expired', 'lapsed')",
        )?,
        premium_under_management: money(
            "SELECT IFNULL(SUM(premium_amount), 0) FROM policies WHERE status = 'active'",
        )?,
        commission_expected: money(
            "SELECT IFNULL(SUM(commission_expected), 0) FROM policies WHERE status = 'active'",
        )?,
        clients_without_email: scalar(&format!(
            "SELECT COUNT(*) {holders} AND c.is_archived = 0 AND (c.email IS NULL OR c.email = '')"
        ))?,
        buckets,
        by_category,
        upcoming,
        recently_lapsed,
    })
}

fn policies(conn: &Connection, tail: &str) -> AppResult<Vec<Policy>> {
    let sql = format!("SELECT {POLICY_COLUMNS} FROM policy_overview {tail}");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], Policy::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}
