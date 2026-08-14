//! Working out which reminders are due, queueing them, and sending them.
//!
//! The sweep is deliberately split in two. Planning decides what should go out
//! and writes it to the outbox; dispatch takes what is in the outbox and tries
//! to deliver it. Keeping them apart is what lets a send fail — a laptop lid
//! closing mid-run, a mail server having a bad morning — without losing the
//! reminder or sending it twice.

use chrono::{Duration, NaiveDate};
use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::mail::{Outgoing, SmtpConfig};
use crate::models::{PlannedReminder, ReminderOverview, ReminderRun};
use crate::repo::{notifications, rules, settings, templates};
use crate::templating::{self, Context};
use crate::util;

/// Attempts before a queued reminder is parked as failed for the operator to
/// look at. Three sweeps is enough to ride out a server having a bad morning.
const MAX_ATTEMPTS: i64 = 3;

/// Delivers a message. Implemented by the SMTP mailer, and by a recording fake
/// in the tests so the engine can be exercised without a mail server.
pub trait Sender {
    fn deliver(&self, message: &Outgoing) -> AppResult<()>;
}

impl Sender for crate::mail::Mailer {
    fn deliver(&self, message: &Outgoing) -> AppResult<()> {
        self.send(message)
    }
}

/// Raises a desktop notification. The engine does not depend on Tauri, so the
/// command layer passes one of these in.
pub trait Alerter {
    fn alert(&self, title: &str, body: &str);
}

/// Stands in for an alerter where there is no desktop to alert, which today is
/// only the tests. Every caller in the app itself passes `DesktopAlerts`.
#[cfg(test)]
pub struct NoAlerts;

#[cfg(test)]
impl Alerter for NoAlerts {
    fn alert(&self, _title: &str, _body: &str) {}
}

pub struct SweepOptions {
    pub today: NaiveDate,
    /// Work out and record what would go out, but send nothing.
    pub dry_run: bool,
}

impl SweepOptions {
    pub fn live() -> Self {
        Self {
            today: util::today(),
            dry_run: false,
        }
    }
}

/// One policy that a rule matches today, with everything needed to write it to
/// the outbox.
struct Match {
    rule_id: i64,
    rule_name: String,
    channel: String,
    template_id: Option<i64>,
    policy_id: i64,
    policy_number: String,
    client_id: i64,
    client_name: String,
    client_email: Option<String>,
    expiry_date: String,
    days_to_expiry: i64,
    blocked: Option<String>,
}

/// What the sweep would do today, without writing anything.
pub fn plan(conn: &Connection, today: NaiveDate) -> AppResult<Vec<PlannedReminder>> {
    let provider = provider_context(conn)?;
    let mut planned = Vec::new();

    for candidate in candidates(conn, today)? {
        let subject = match candidate.template_id {
            Some(id) => {
                let template = templates::get(conn, id)?;
                let context = policy_context(conn, candidate.policy_id, &provider)?;
                templating::render(&template.subject, &context)
            }
            None => candidate.rule_name.clone(),
        };

        planned.push(PlannedReminder {
            rule_id: candidate.rule_id,
            rule_name: candidate.rule_name,
            policy_id: candidate.policy_id,
            policy_number: candidate.policy_number,
            client_id: candidate.client_id,
            client_name: candidate.client_name,
            to_address: candidate.client_email,
            expiry_date: candidate.expiry_date,
            days_to_expiry: candidate.days_to_expiry,
            channel: candidate.channel,
            subject,
            blocked_reason: candidate.blocked,
        });
    }

    Ok(planned)
}

/// Plans, queues and sends in one pass. Returns what happened.
pub fn sweep(
    conn: &Connection,
    sender: Option<&dyn Sender>,
    alerter: &dyn Alerter,
    options: &SweepOptions,
) -> AppResult<ReminderRun> {
    let mut run = ReminderRun {
        dry_run: options.dry_run,
        ..Default::default()
    };

    let provider = provider_context(conn)?;
    let matches = candidates(conn, options.today)?;

    for candidate in matches {
        // A blocked reminder is still recorded, once, so the operator can see
        // why nothing was sent and the same client is not raised every day.
        if let Some(reason) = &candidate.blocked {
            run.skipped += 1;
            if !options.dry_run {
                record_skip(conn, &candidate, reason)?;
            }
            continue;
        }

        let Some(template_id) = candidate.template_id else {
            run.skipped += 1;
            run.issues.push(format!(
                "{} has no message to send, so {} was not written to.",
                candidate.rule_name, candidate.client_name
            ));
            continue;
        };

        let template = templates::get(conn, template_id)?;
        let context = policy_context(conn, candidate.policy_id, &provider)?;
        let subject = templating::render(&template.subject, &context);
        let body = templating::render(&template.body_html, &context);

        if options.dry_run {
            run.queued += 1;
            continue;
        }

        let entry = notifications::NewNotification {
            rule_id: candidate.rule_id,
            policy_id: candidate.policy_id,
            client_id: candidate.client_id,
            policy_period: candidate.expiry_date.clone(),
            audience: "client".into(),
            channel: candidate.channel.clone(),
            to_address: candidate.client_email.clone(),
            subject,
            body,
            scheduled_for: util::iso(options.today),
        };
        if notifications::queue(conn, &entry)?.is_some() {
            run.queued += 1;
        }

        if candidate.channel != "email" {
            alerter.alert(
                &format!("{} expires soon", candidate.client_name),
                &format!(
                    "{} · {} · {} days",
                    candidate.policy_number,
                    util::format_date(&candidate.expiry_date, &provider.date_format),
                    candidate.days_to_expiry
                ),
            );
            run.desktop_alerts += 1;
        }
    }

    if !options.dry_run {
        dispatch(conn, sender, options, &mut run)?;
        run.digest_sent = send_digest(conn, sender, alerter, options, &mut run)?;
        settings::put(conn, "last_sweep_at", &chrono::Local::now().to_rfc3339())?;
    }

    Ok(run)
}

/// Sends what is sitting in the outbox, newest failures included, up to the
/// daily cap.
fn dispatch(
    conn: &Connection,
    sender: Option<&dyn Sender>,
    options: &SweepOptions,
    run: &mut ReminderRun,
) -> AppResult<()> {
    let cap = settings::get_i64(conn, "daily_send_cap", 400).max(0);
    let already_sent = notifications::sent_on(conn, &util::iso(options.today))?;
    let allowance = (cap - already_sent).max(0);

    let waiting = notifications::due(
        conn,
        &format!("{} 23:59:59", util::iso(options.today)),
        5_000,
    )?;
    let total_waiting = waiting.len();

    let Some(sender) = sender else {
        run.issues
            .push("No mail server is set up, so nothing was sent.".into());
        return Ok(());
    };

    for payload in waiting.into_iter().take(allowance as usize) {
        // Desktop-only rows have already been shown; nothing is emailed.
        if payload.channel == "desktop" {
            notifications::mark_sent(conn, payload.id)?;
            run.sent += 1;
            continue;
        }

        let Some(address) = payload.to_address.clone().filter(|a| !a.trim().is_empty()) else {
            notifications::mark_skipped(conn, payload.id, "No email address")?;
            run.skipped += 1;
            continue;
        };

        let message = Outgoing {
            to_name: payload.client_name.clone(),
            to_email: address,
            subject: payload.subject.clone(),
            html: payload.body.clone(),
        };

        match sender.deliver(&message) {
            Ok(()) => {
                notifications::mark_sent(conn, payload.id)?;
                run.sent += 1;
            }
            Err(err) => {
                let message = err.to_string();
                notifications::mark_attempt_failed(conn, payload.id, &message, MAX_ATTEMPTS)?;
                run.failed += 1;
                if run.issues.len() < 20 {
                    run.issues
                        .push(format!("{}: {message}", payload.client_name));
                }
            }
        }
    }

    if total_waiting > allowance as usize {
        run.held_by_cap = total_waiting - allowance as usize;
        run.issues.push(format!(
            "{} reminders are waiting for tomorrow: today's cap of {cap} was reached.",
            run.held_by_cap
        ));
    }

    Ok(())
}

/// One message to the agency summarising the day, rather than one per policy.
fn send_digest(
    conn: &Connection,
    sender: Option<&dyn Sender>,
    alerter: &dyn Alerter,
    options: &SweepOptions,
    run: &mut ReminderRun,
) -> AppResult<bool> {
    if settings::get_or(conn, "digest_enabled", "true") != "true" {
        return Ok(false);
    }

    let today_iso = util::iso(options.today);
    let window = settings::get_i64(conn, "expiring_soon_window", 30).clamp(1, 365);
    let horizon = util::iso(options.today + Duration::days(window));

    let mut stmt = conn.prepare(
        "SELECT client_name, policy_number, insurer_name, category, expiry_date, \
                COALESCE(premium_amount, 0) \
         FROM policy_overview \
         WHERE status = 'active' AND expiry_date <= ?2 \
         ORDER BY expiry_date LIMIT 100",
    )?;
    let rows = stmt
        .query_map(params![today_iso, horizon], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, f64>(5)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    if rows.is_empty() {
        return Ok(false);
    }

    let provider = provider_context(conn)?;
    if settings::get_or(conn, "desktop_alerts", "true") == "true" {
        alerter.alert(
            "StayInsured",
            &format!("{} policies expire within {window} days.", rows.len()),
        );
        run.desktop_alerts += 1;
    }

    let to = settings::get_or(conn, "provider_email", "");
    if to.trim().is_empty() || sender.is_none() {
        return Ok(false);
    }
    if digest_already_sent(conn, &today_iso)? {
        return Ok(false);
    }

    let Some(template) = templates::active_for_trigger(conn, "provider_digest")? else {
        return Ok(false);
    };

    let mut table = String::from(
        "<table cellpadding=\"6\" style=\"border-collapse:collapse;font-size:14px\">\
         <tr style=\"text-align:left;color:#6b7280\"><th>Client</th><th>Policy</th>\
         <th>Insurer</th><th>Type</th><th>Expires</th><th>Premium</th></tr>",
    );
    for (client, number, insurer, category, expiry, premium) in &rows {
        table.push_str(&format!(
            "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",
            templating::escape_html(client),
            templating::escape_html(number),
            templating::escape_html(insurer),
            util::category_label(category),
            util::format_date(expiry, &provider.date_format),
            util::format_money(*premium, &provider.currency),
        ));
    }
    table.push_str("</table>");

    let mut context = Context::new();
    context
        .set("provider_name", &provider.name)
        .set("provider_email", &provider.email)
        .set("provider_phone", &provider.phone)
        .set(
            "today",
            util::format_date(&today_iso, &provider.date_format),
        )
        .set("expiring_count", rows.len().to_string())
        .set("digest_table", table);

    let subject = templating::render(&template.subject, &context);
    let body = templating::render(&template.body_html, &context);

    let sent = sender
        .expect("checked above")
        .deliver(&Outgoing {
            to_name: provider.name.clone(),
            to_email: to.clone(),
            subject: subject.clone(),
            html: body.clone(),
        })
        .is_ok();

    conn.execute(
        "INSERT INTO notification_log (rule_id, policy_id, client_id, policy_period, audience, \
             channel, to_address, subject, body_snapshot, status, scheduled_for, sent_at) \
         VALUES (NULL, NULL, NULL, ?1, 'provider', 'email', ?2, ?3, ?4, ?5, ?1, \
                 CASE WHEN ?6 THEN datetime('now') END)",
        params![
            today_iso,
            to,
            subject,
            body,
            if sent { "sent" } else { "failed" },
            sent,
        ],
    )?;

    Ok(sent)
}

fn digest_already_sent(conn: &Connection, today_iso: &str) -> AppResult<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM notification_log \
         WHERE audience = 'provider' AND policy_period = ?1 AND status IN ('sent', 'queued')",
        params![today_iso],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Every policy that an active rule matches today.
fn candidates(conn: &Connection, today: NaiveDate) -> AppResult<Vec<Match>> {
    let mut found = Vec::new();

    for rule in rules::active(conn)? {
        if rule.audience != "client" {
            continue;
        }

        // The rule fires when expiry is exactly its offset away: 30 days before
        // expiry means expiry is 30 days from today.
        let target = util::iso(today + Duration::days(rule.offset_days));

        // After expiry, only policies nobody has renewed are worth chasing.
        let status_clause = if rule.offset_days < 0 {
            "p.status IN ('expired', 'lapsed')"
        } else {
            "p.status = 'active'"
        };
        let category_clause = match &rule.category {
            Some(_) => "AND p.category = ?2",
            None => "",
        };

        let sql = format!(
            "SELECT p.id, p.policy_number, p.client_id, p.expiry_date, c.full_name, c.email, \
                    c.reminders_opted_out \
             FROM policies p JOIN clients c ON c.id = p.client_id \
             WHERE p.expiry_date = ?1 AND {status_clause} AND c.is_archived = 0 \
                   AND NOT EXISTS (SELECT 1 FROM policies later \
                                   WHERE later.previous_policy_id = p.id) \
                   {category_clause} \
             ORDER BY c.full_name"
        );

        let mut stmt = conn.prepare(&sql)?;
        let mapper = |row: &rusqlite::Row| -> rusqlite::Result<Match> {
            let email: Option<String> = row.get(5)?;
            let opted_out: i64 = row.get(6)?;
            Ok(Match {
                rule_id: rule.id,
                rule_name: rule.name.clone(),
                channel: rule.channel.clone(),
                template_id: rule.template_id,
                policy_id: row.get(0)?,
                policy_number: row.get(1)?,
                client_id: row.get(2)?,
                client_name: row.get(4)?,
                expiry_date: row.get(3)?,
                days_to_expiry: rule.offset_days,
                blocked: if opted_out != 0 {
                    Some("The client has opted out of reminders".into())
                } else if email.as_deref().map(str::trim).unwrap_or("").is_empty() {
                    Some("No email address on the client".into())
                } else if !util::looks_like_email(email.as_deref().unwrap_or("")) {
                    Some("The email address does not look valid".into())
                } else {
                    None
                },
                client_email: email,
            })
        };

        let rows: Vec<Match> = match &rule.category {
            Some(category) => stmt
                .query_map(params![target, category], mapper)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
            None => stmt
                .query_map(params![target], mapper)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
        };

        for candidate in rows {
            if notifications::already_logged(
                conn,
                candidate.rule_id,
                candidate.policy_id,
                &candidate.expiry_date,
            )? {
                continue;
            }
            found.push(candidate);
        }
    }

    Ok(found)
}

fn record_skip(conn: &Connection, candidate: &Match, reason: &str) -> AppResult<()> {
    let entry = notifications::NewNotification {
        rule_id: candidate.rule_id,
        policy_id: candidate.policy_id,
        client_id: candidate.client_id,
        policy_period: candidate.expiry_date.clone(),
        audience: "client".into(),
        channel: candidate.channel.clone(),
        to_address: candidate.client_email.clone(),
        subject: candidate.rule_name.clone(),
        body: String::new(),
        scheduled_for: candidate.expiry_date.clone(),
    };
    if let Some(id) = notifications::queue(conn, &entry)? {
        notifications::mark_skipped(conn, id, reason)?;
    }
    Ok(())
}

/// The agency's own details, needed by every message.
pub struct Provider {
    pub name: String,
    pub email: String,
    pub phone: String,
    pub address: String,
    pub date_format: String,
    pub currency: String,
}

pub fn provider_context(conn: &Connection) -> AppResult<Provider> {
    Ok(Provider {
        name: settings::get_or(conn, "provider_name", "Your agency"),
        email: settings::get_or(conn, "provider_email", ""),
        phone: settings::get_or(conn, "provider_phone", ""),
        address: settings::get_or(conn, "provider_address", ""),
        date_format: settings::get_or(conn, "date_format", "dd/MM/yyyy"),
        currency: settings::get_or(conn, "currency", "INR"),
    })
}

/// Fills every placeholder the catalogue offers for one policy.
pub fn policy_context(
    conn: &Connection,
    policy_id: i64,
    provider: &Provider,
) -> AppResult<Context> {
    let mut context = Context::new();
    context
        .set("provider_name", &provider.name)
        .set("provider_email", &provider.email)
        .set("provider_phone", &provider.phone)
        .set("provider_address", &provider.address)
        .set(
            "today",
            util::format_date(&util::today_iso(), &provider.date_format),
        );

    let mut stmt = conn.prepare(
        "SELECT client_name, client_code, client_email, client_phone, policy_number, category, \
                insurer_name, product_name, start_date, expiry_date, policy_year, sum_insured, \
                premium_amount, nominee_name, vehicle_number \
         FROM policy_overview WHERE id = ?1",
    )?;
    let mut rows = stmt.query(params![policy_id])?;
    let Some(row) = rows.next()? else {
        return Err(AppError::NotFound("Policy"));
    };

    let expiry: String = row.get(9)?;
    context
        .set("client_name", row.get::<_, String>(0)?)
        .set("client_code", row.get::<_, String>(1)?)
        .set_opt("client_email", row.get::<_, Option<String>>(2)?)
        .set_opt("client_phone", row.get::<_, Option<String>>(3)?)
        .set("policy_number", row.get::<_, String>(4)?)
        .set(
            "category_label",
            util::category_label(&row.get::<_, String>(5)?),
        )
        .set("insurer_name", row.get::<_, String>(6)?)
        .set_opt("product_name", row.get::<_, Option<String>>(7)?)
        .set(
            "start_date",
            util::format_date(&row.get::<_, String>(8)?, &provider.date_format),
        )
        .set(
            "expiry_date",
            util::format_date(&expiry, &provider.date_format),
        )
        .set(
            "days_to_expiry",
            util::days_until(&expiry).unwrap_or(0).to_string(),
        )
        .set("policy_year", row.get::<_, i64>(10)?.to_string())
        .set(
            "sum_insured",
            row.get::<_, Option<f64>>(11)?
                .map(|v| util::format_money(v, &provider.currency))
                .unwrap_or_default(),
        )
        .set(
            "premium_amount",
            row.get::<_, Option<f64>>(12)?
                .map(|v| util::format_money(v, &provider.currency))
                .unwrap_or_default(),
        )
        .set_opt("nominee_name", row.get::<_, Option<String>>(13)?)
        .set_opt("vehicle_number", row.get::<_, Option<String>>(14)?);

    Ok(context)
}

/// A real policy to preview a template against, preferring one that expires
/// soon so the sample reads like the messages that actually go out.
pub fn sample_policy(conn: &Connection) -> AppResult<Option<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, policy_number || ' · ' || client_name FROM policy_overview \
         ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, expiry_date LIMIT 1",
    )?;
    let mut rows = stmt.query([])?;
    match rows.next()? {
        Some(row) => Ok(Some((row.get(0)?, row.get(1)?))),
        None => Ok(None),
    }
}

/// Stand-in values so a template can be previewed before any policy exists.
pub fn example_context(provider: &Provider) -> Context {
    let mut context = Context::new();
    let expiry = util::today() + Duration::days(30);
    context
        .set("client_name", "Ananya Sharma")
        .set("client_code", "CL-00001")
        .set("client_email", "ananya.sharma@example.com")
        .set("client_phone", "9876543210")
        .set("policy_number", "SH/2026/884213")
        .set("category_label", "Health")
        .set("insurer_name", "Star Health and Allied Insurance")
        .set("product_name", "Family Health Optima")
        .set(
            "start_date",
            util::format_date(
                &util::iso(expiry - Duration::days(365)),
                &provider.date_format,
            ),
        )
        .set(
            "expiry_date",
            util::format_date(&util::iso(expiry), &provider.date_format),
        )
        .set("days_to_expiry", "30")
        .set("policy_year", "3")
        .set("sum_insured", util::format_money(1_000_000.0, &provider.currency))
        .set("premium_amount", util::format_money(24_500.0, &provider.currency))
        .set("nominee_name", "Rohit Sharma")
        .set("vehicle_number", "")
        .set("provider_name", &provider.name)
        .set("provider_email", &provider.email)
        .set("provider_phone", &provider.phone)
        .set("provider_address", &provider.address)
        .set(
            "today",
            util::format_date(&util::today_iso(), &provider.date_format),
        )
        .set("expiring_count", "12")
        .set(
            "digest_table",
            "<table cellpadding=\"6\" style=\"border-collapse:collapse;font-size:14px\">\
             <tr><td>Ananya Sharma</td><td>SH/2026/884213</td><td>Expires in 30 days</td></tr></table>",
        );
    context
}

pub fn overview(conn: &Connection) -> AppResult<ReminderOverview> {
    let smtp = SmtpConfig::load(conn)?;
    let today = util::today();
    let due = plan(conn, today)?;

    let active_rules: i64 = conn.query_row(
        "SELECT COUNT(*) FROM reminder_rules WHERE is_active = 1",
        [],
        |row| row.get(0),
    )?;
    let clients_opted_out: i64 = conn.query_row(
        "SELECT COUNT(*) FROM clients WHERE reminders_opted_out = 1 AND is_archived = 0",
        [],
        |row| row.get(0),
    )?;
    let window = settings::get_i64(conn, "expiring_soon_window", 30).clamp(1, 365);
    let expiring_without_email: i64 = conn.query_row(
        "SELECT COUNT(*) FROM policy_overview \
         WHERE status = 'active' AND expiry_date <= ?1 \
               AND (client_email IS NULL OR trim(client_email) = '')",
        params![util::iso(today + Duration::days(window))],
        |row| row.get(0),
    )?;

    Ok(ReminderOverview {
        enabled: settings::get_or(conn, "reminders_enabled", "false") == "true",
        dry_run: settings::get_or(conn, "dry_run", "true") == "true",
        smtp_configured: smtp.is_usable(),
        smtp_password_set: !smtp.password.is_empty(),
        from_email: smtp.from_email,
        send_time: settings::get_or(conn, "reminder_send_time", "09:00"),
        daily_cap: settings::get_i64(conn, "daily_send_cap", 400),
        digest_enabled: settings::get_or(conn, "digest_enabled", "true") == "true",
        desktop_alerts: settings::get_or(conn, "desktop_alerts", "true") == "true",
        active_rules,
        due_today: due.len() as i64,
        queued: notifications::count_by_status(conn, "queued")?,
        failed: notifications::count_by_status(conn, "failed")?,
        sent_today: notifications::sent_on(conn, &util::iso(today))?,
        last_sweep: settings::get(conn, "last_sweep_at")?,
        clients_opted_out,
        expiring_without_email,
    })
}
