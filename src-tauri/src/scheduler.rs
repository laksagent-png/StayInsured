//! The daily sweep.
//!
//! A thread ticks once a minute and asks whether today's sweep has already run.
//! Phrasing it that way, rather than as "wake me at 09:00", is what makes a
//! missed slot harmless: a laptop that was asleep at nine sweeps as soon as it
//! is opened, and one that was open all day still sweeps exactly once.

use std::time::Duration;

use chrono::{Local, NaiveTime};
use tauri::{AppHandle, Emitter, Manager};

use crate::alerts::DesktopAlerts;
use crate::error::AppResult;
use crate::mail::{Mailer, SmtpConfig};
use crate::reminders::{self, SweepOptions};
use crate::repo::settings;
use crate::state::AppState;
use crate::util;

const TICK: Duration = Duration::from_secs(60);

pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(TICK);
        match tick(&app) {
            Ok(true) => {}
            Ok(false) => {}
            Err(err) => tracing::warn!(%err, "the reminder sweep could not run"),
        }
    });
}

/// Returns whether a sweep actually ran.
fn tick(app: &AppHandle) -> AppResult<bool> {
    let state = app.state::<AppState>();
    // Locked means the key is not in memory, so there is nothing to read and
    // nothing to send. The sweep resumes after the next unlock.
    let Ok(db) = state.db() else {
        return Ok(false);
    };

    let due = db.with(|conn| Ok(is_due(conn)))?;
    if !due {
        return Ok(false);
    }

    let config = db.with(SmtpConfig::load)?;
    let mailer = if config.is_usable() {
        Mailer::connect(&config).ok()
    } else {
        None
    };
    let alerter = DesktopAlerts::new(app.clone());

    let run = db.with_tx(|tx| {
        reminders::sweep(
            tx,
            mailer.as_ref().map(|m| m as &dyn reminders::Sender),
            &alerter,
            &SweepOptions::live(),
        )
    })?;

    tracing::info!(
        queued = run.queued,
        sent = run.sent,
        failed = run.failed,
        skipped = run.skipped,
        "reminder sweep finished"
    );

    // The reminders screen refreshes itself rather than showing yesterday's
    // numbers until someone reloads it.
    let _ = app.emit("reminders:swept", &run);
    Ok(true)
}

/// True when reminders are switched on, the send time has passed, and today has
/// not been swept yet.
fn is_due(conn: &rusqlite::Connection) -> bool {
    if settings::get_or(conn, "reminders_enabled", "false") != "true" {
        return false;
    }

    let now = Local::now();
    let send_time = parse_time(&settings::get_or(conn, "reminder_send_time", "09:00"));
    if now.time() < send_time {
        return false;
    }

    match settings::get(conn, "last_sweep_at").ok().flatten() {
        Some(stamp) => !stamp.starts_with(&util::iso(now.date_naive())),
        None => true,
    }
}

fn parse_time(raw: &str) -> NaiveTime {
    NaiveTime::parse_from_str(raw.trim(), "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(raw.trim(), "%H:%M:%S"))
        .unwrap_or_else(|_| NaiveTime::from_hms_opt(9, 0, 0).expect("09:00 is a valid time"))
}
