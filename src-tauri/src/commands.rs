use std::collections::HashMap;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};

use crate::alerts::DesktopAlerts;
use crate::db::{migrations, Database};
use crate::error::{AppError, AppResult};
use crate::importer::{self, FieldInfo, ImportOptions, ImportPreview, ImportReport};
use crate::mail::{Mailer, SmtpConfig};
use crate::models::*;
use crate::reminders::SweepOptions;
use crate::repo::{
    clients, dashboard, documents, insurers, members, notifications, policies, products, rules,
    settings, templates,
};
use crate::state::AppState;
use crate::{exporter, mail, reminders, templating, util, vault};

// ------------------------------------------------------------------ session

#[tauri::command]
pub fn session_state(state: State<AppState>) -> SessionState {
    SessionState {
        initialised: vault::Vault::exists(&state.paths.vault),
        unlocked: state.is_unlocked(),
        can_use_keychain: vault::recall_key().is_some(),
        encrypted: true,
        schema_version: migrations::latest_version(),
        data_dir: state.paths.root.to_string_lossy().to_string(),
    }
}

/// First run: creates the vault parameters, the encrypted database and the owner.
#[tauri::command]
pub fn setup(
    state: State<AppState>,
    password: String,
    display_name: Option<String>,
    remember: Option<bool>,
) -> AppResult<SessionState> {
    if vault::Vault::exists(&state.paths.vault) {
        return Err(AppError::AlreadyInitialised);
    }
    if password.chars().count() < 8 {
        return Err(AppError::validation(
            "Use a password of at least 8 characters",
        ));
    }

    let vault_file = vault::Vault::create();
    let key = vault_file.derive_key(&password)?;
    let db = Database::open(&state.paths.database, &key)?;

    let name = display_name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "Owner".into());
    let hash = vault::hash_password(&password)?;
    db.with(|conn| {
        conn.execute(
            "INSERT INTO users (username, display_name, password_hash, role) \
             VALUES ('owner', ?1, ?2, 'owner')",
            rusqlite::params![name, hash],
        )?;
        settings::put(conn, "provider_name", &name)?;
        Ok(())
    })?;

    // Written last: while this file is absent the install still counts as fresh.
    vault_file.save(&state.paths.vault)?;

    if remember.unwrap_or(false) {
        vault::remember_key(&key)?;
    }
    state.set_db(db);
    Ok(session_state(state))
}

#[tauri::command]
pub fn unlock(
    state: State<AppState>,
    password: String,
    remember: Option<bool>,
) -> AppResult<SessionState> {
    let vault_file = vault::Vault::load(&state.paths.vault)?;
    let key = vault_file.derive_key(&password)?;
    let db = Database::open(&state.paths.database, &key)?;

    let stored: Option<String> = db
        .with(|conn| {
            Ok(conn
                .query_row(
                    "SELECT password_hash FROM users WHERE username = 'owner'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .ok())
        })
        .unwrap_or(None);

    // The database opening at all already proves the password, so a mismatch here
    // only happens on a legacy row; treat it as authoritative anyway.
    if let Some(hash) = stored {
        if !vault::verify_password(&password, &hash) {
            return Err(AppError::BadPassword);
        }
    }

    db.with(|conn| {
        conn.execute(
            "UPDATE users SET last_login_at = datetime('now') WHERE username = 'owner'",
            [],
        )?;
        policies::sync_statuses(conn)?;
        Ok(())
    })?;

    if remember.unwrap_or(false) {
        vault::remember_key(&key)?;
    }
    state.set_db(db);
    Ok(session_state(state))
}

/// Unlocks using the key held in the OS keychain, for "trust this device".
#[tauri::command]
pub fn unlock_with_keychain(state: State<AppState>) -> AppResult<SessionState> {
    let key = vault::recall_key().ok_or(AppError::Locked)?;
    let db = Database::open(&state.paths.database, &key)?;
    db.with(|conn| {
        policies::sync_statuses(conn)?;
        Ok(())
    })?;
    state.set_db(db);
    Ok(session_state(state))
}

#[tauri::command]
pub fn lock(state: State<AppState>) -> SessionState {
    state.lock();
    session_state(state)
}

#[tauri::command]
pub fn forget_device(state: State<AppState>) -> AppResult<SessionState> {
    vault::forget_key()?;
    Ok(session_state(state))
}

#[tauri::command]
pub fn change_password(
    state: State<AppState>,
    current: String,
    replacement: String,
) -> AppResult<()> {
    if replacement.chars().count() < 8 {
        return Err(AppError::validation(
            "Use a password of at least 8 characters",
        ));
    }
    let db = state.db()?;
    let old_vault = vault::Vault::load(&state.paths.vault)?;
    let old_key = old_vault.derive_key(&current)?;

    let hash: String = db.with(|conn| {
        Ok(conn.query_row(
            "SELECT password_hash FROM users WHERE username = 'owner'",
            [],
            |row| row.get(0),
        )?)
    })?;
    if !vault::verify_password(&current, &hash) {
        return Err(AppError::BadPassword);
    }

    let new_vault = vault::Vault::create();
    let new_key = new_vault.derive_key(&replacement)?;
    db.rekey(&new_key)?;

    // The vault file must match the key now on disk; if it cannot be written the
    // database is put back to the old key rather than left unopenable.
    if let Err(err) = new_vault.save(&state.paths.vault) {
        db.rekey(&old_key)?;
        return Err(err);
    }

    let new_hash = vault::hash_password(&replacement)?;
    db.with(|conn| {
        conn.execute(
            "UPDATE users SET password_hash = ?1 WHERE username = 'owner'",
            rusqlite::params![new_hash],
        )?;
        Ok(())
    })?;

    if vault::recall_key().is_some() {
        vault::remember_key(&new_key)?;
    }
    Ok(())
}

// ------------------------------------------------------------------ dashboard & lookups

#[tauri::command]
pub fn load_dashboard(state: State<AppState>) -> AppResult<Dashboard> {
    state.db()?.with(dashboard::load)
}

#[tauri::command]
pub fn category_options() -> Vec<LookupItem> {
    util::CATEGORIES
        .iter()
        .enumerate()
        .map(|(index, key)| LookupItem {
            id: index as i64,
            label: util::category_label(key).to_string(),
            secondary: Some((*key).to_string()),
        })
        .collect()
}

#[tauri::command]
pub fn client_cities(state: State<AppState>) -> AppResult<Vec<String>> {
    state.db()?.with(clients::distinct_cities)
}

// ------------------------------------------------------------------ clients

#[tauri::command]
pub fn list_clients(state: State<AppState>, filter: ClientFilter) -> AppResult<Page<Client>> {
    state.db()?.with(|conn| clients::list(conn, &filter))
}

#[tauri::command]
pub fn get_client(state: State<AppState>, id: i64) -> AppResult<Client> {
    state.db()?.with(|conn| clients::get(conn, id))
}

#[tauri::command]
pub fn create_client(state: State<AppState>, input: ClientInput) -> AppResult<i64> {
    state.db()?.with_tx(|tx| clients::create(tx, &input))
}

#[tauri::command]
pub fn update_client(state: State<AppState>, id: i64, input: ClientInput) -> AppResult<()> {
    state.db()?.with_tx(|tx| clients::update(tx, id, &input))
}

#[tauri::command]
pub fn set_client_archived(state: State<AppState>, id: i64, archived: bool) -> AppResult<()> {
    state
        .db()?
        .with_tx(|tx| clients::set_archived(tx, id, archived))
}

#[tauri::command]
pub fn delete_client(state: State<AppState>, id: i64) -> AppResult<()> {
    state.db()?.with_tx(|tx| clients::delete(tx, id))
}

#[tauri::command]
pub fn next_client_code(state: State<AppState>) -> AppResult<String> {
    state.db()?.with(clients::next_client_code)
}

// ------------------------------------------------------------------ members

#[tauri::command]
pub fn list_members(state: State<AppState>, client_id: i64) -> AppResult<Vec<InsuredMember>> {
    state
        .db()?
        .with(|conn| members::list_for_client(conn, client_id))
}

#[tauri::command]
pub fn create_member(state: State<AppState>, input: MemberInput) -> AppResult<i64> {
    state.db()?.with_tx(|tx| members::create(tx, &input))
}

#[tauri::command]
pub fn update_member(state: State<AppState>, id: i64, input: MemberInput) -> AppResult<()> {
    state.db()?.with_tx(|tx| members::update(tx, id, &input))
}

#[tauri::command]
pub fn delete_member(state: State<AppState>, id: i64) -> AppResult<()> {
    state.db()?.with_tx(|tx| members::delete(tx, id))
}

// ------------------------------------------------------------------ documents

#[tauri::command]
pub fn list_documents(state: State<AppState>, client_id: i64) -> AppResult<Vec<Document>> {
    state
        .db()?
        .with(|conn| documents::list_for_client(conn, client_id))
}

#[tauri::command]
pub fn attach_document(state: State<AppState>, input: DocumentInput) -> AppResult<i64> {
    state.db()?.with_tx(|tx| documents::attach(tx, &input))
}

/// The stored bytes, sent raw rather than as JSON so that opening a scan does not
/// cost a base64 round trip through the bridge.
#[tauri::command]
pub fn document_content(state: State<AppState>, id: i64) -> AppResult<tauri::ipc::Response> {
    let bytes = state.db()?.with(|conn| documents::content(conn, id))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn save_document_copy(state: State<AppState>, id: i64, path: String) -> AppResult<()> {
    let bytes = state.db()?.with(|conn| documents::content(conn, id))?;
    std::fs::write(&path, bytes)?;
    Ok(())
}

#[tauri::command]
pub fn delete_document(state: State<AppState>, id: i64) -> AppResult<()> {
    state.db()?.with_tx(|tx| documents::delete(tx, id))
}

// ------------------------------------------------------------------ insurers & products

#[tauri::command]
pub fn list_insurers(
    state: State<AppState>,
    include_inactive: Option<bool>,
) -> AppResult<Vec<Insurer>> {
    state
        .db()?
        .with(|conn| insurers::list(conn, include_inactive.unwrap_or(false)))
}

#[tauri::command]
pub fn insurer_options(state: State<AppState>) -> AppResult<Vec<LookupItem>> {
    state.db()?.with(insurers::lookup)
}

#[tauri::command]
pub fn create_insurer(state: State<AppState>, input: InsurerInput) -> AppResult<i64> {
    state.db()?.with_tx(|tx| insurers::create(tx, &input))
}

#[tauri::command]
pub fn update_insurer(state: State<AppState>, id: i64, input: InsurerInput) -> AppResult<()> {
    state.db()?.with_tx(|tx| insurers::update(tx, id, &input))
}

#[tauri::command]
pub fn delete_insurer(state: State<AppState>, id: i64) -> AppResult<()> {
    state.db()?.with_tx(|tx| insurers::delete(tx, id))
}

#[tauri::command]
pub fn list_products(
    state: State<AppState>,
    insurer_id: Option<i64>,
    include_inactive: Option<bool>,
) -> AppResult<Vec<Product>> {
    state
        .db()?
        .with(|conn| products::list(conn, insurer_id, include_inactive.unwrap_or(false)))
}

#[tauri::command]
pub fn create_product(state: State<AppState>, input: ProductInput) -> AppResult<i64> {
    state.db()?.with_tx(|tx| products::create(tx, &input))
}

#[tauri::command]
pub fn update_product(state: State<AppState>, id: i64, input: ProductInput) -> AppResult<()> {
    state.db()?.with_tx(|tx| products::update(tx, id, &input))
}

#[tauri::command]
pub fn delete_product(state: State<AppState>, id: i64) -> AppResult<()> {
    state.db()?.with_tx(|tx| products::delete(tx, id))
}

// ------------------------------------------------------------------ policies

#[tauri::command]
pub fn list_policies(state: State<AppState>, filter: PolicyFilter) -> AppResult<Page<Policy>> {
    state.db()?.with(|conn| policies::list(conn, &filter))
}

#[tauri::command]
pub fn get_policy(state: State<AppState>, id: i64) -> AppResult<Policy> {
    state.db()?.with(|conn| policies::get(conn, id))
}

#[tauri::command]
pub fn policy_chain(state: State<AppState>, id: i64) -> AppResult<Vec<Policy>> {
    state.db()?.with(|conn| policies::chain(conn, id))
}

#[tauri::command]
pub fn policy_member_ids(state: State<AppState>, id: i64) -> AppResult<Vec<i64>> {
    state.db()?.with(|conn| policies::members_of(conn, id))
}

#[tauri::command]
pub fn create_policy(state: State<AppState>, input: PolicyInput) -> AppResult<i64> {
    state.db()?.with_tx(|tx| policies::create(tx, &input))
}

#[tauri::command]
pub fn update_policy(state: State<AppState>, id: i64, input: PolicyInput) -> AppResult<()> {
    state.db()?.with_tx(|tx| policies::update(tx, id, &input))
}

#[tauri::command]
pub fn renew_policy(state: State<AppState>, input: RenewalInput) -> AppResult<i64> {
    state.db()?.with_tx(|tx| policies::renew(tx, &input))
}

#[tauri::command]
pub fn set_policy_status(state: State<AppState>, id: i64, status: String) -> AppResult<()> {
    state
        .db()?
        .with_tx(|tx| policies::set_status(tx, id, &status))
}

#[tauri::command]
pub fn delete_policy(state: State<AppState>, id: i64) -> AppResult<()> {
    state.db()?.with_tx(|tx| policies::delete(tx, id))
}

#[tauri::command]
pub fn refresh_statuses(state: State<AppState>) -> AppResult<usize> {
    state.db()?.with_tx(|tx| policies::sync_statuses(tx))
}

// ------------------------------------------------------------------ import & export

#[tauri::command]
pub fn import_fields() -> Vec<FieldInfo> {
    importer::field_catalogue()
}

#[tauri::command]
pub fn preview_import(path: String, sheet: Option<String>) -> AppResult<ImportPreview> {
    importer::preview(Path::new(&path), sheet.as_deref())
}

#[tauri::command]
pub fn run_import(state: State<AppState>, options: ImportOptions) -> AppResult<ImportReport> {
    let db = state.db()?;
    let report = db.with(|conn| importer::run(conn, &options))?;
    if !options.dry_run.unwrap_or(false) {
        db.with_tx(|tx| policies::sync_statuses(tx))?;
    }
    Ok(report)
}

#[tauri::command]
pub fn write_import_template(path: String) -> AppResult<String> {
    let target = PathBuf::from(&path);
    importer::write_template(&target)?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn export_policies(
    state: State<AppState>,
    filter: PolicyFilter,
    path: String,
) -> AppResult<usize> {
    let rows = state.db()?.with(|conn| policies::list_all(conn, &filter))?;
    exporter::export_policies(&rows, Path::new(&path))
}

#[tauri::command]
pub fn export_clients(
    state: State<AppState>,
    filter: ClientFilter,
    path: String,
) -> AppResult<usize> {
    let mut all = filter;
    all.page = Some(1);
    all.page_size = Some(500);

    let db = state.db()?;
    let mut rows = Vec::new();
    loop {
        let page = db.with(|conn| clients::list(conn, &all))?;
        let fetched = page.rows.len();
        rows.extend(page.rows);
        if rows.len() as i64 >= page.total || fetched == 0 {
            break;
        }
        all.page = Some(all.page.unwrap_or(1) + 1);
    }

    exporter::export_clients(&rows, Path::new(&path))
}

// ------------------------------------------------------------------ settings & maintenance

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> AppResult<HashMap<String, String>> {
    state.db()?.with(settings::all)
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, values: HashMap<String, String>) -> AppResult<()> {
    state.db()?.with_tx(|tx| settings::put_many(tx, &values))
}

/// Takes an encrypted snapshot, prunes old ones, and mirrors it to the folder in
/// settings if one is configured (a synced folder gives off-machine safety).
#[tauri::command]
pub fn backup_now(state: State<AppState>) -> AppResult<String> {
    let db = state.db()?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let file_name = format!("stayinsured-{stamp}.db");
    let local = state.paths.backups.join(&file_name);
    db.backup_to(&local)?;

    let (external_dir, retention) = db.with(|conn| {
        Ok((
            settings::get_or(conn, "backup_dir", ""),
            settings::get_i64(conn, "backup_retention", 14),
        ))
    })?;

    if !external_dir.trim().is_empty() {
        let target_dir = PathBuf::from(external_dir.trim());
        if target_dir.is_dir() {
            std::fs::copy(&local, target_dir.join(&file_name))?;
        }
    }

    prune_backups(&state.paths.backups, retention.max(1) as usize)?;
    Ok(local.to_string_lossy().to_string())
}

fn prune_backups(dir: &Path, keep: usize) -> AppResult<()> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|p| p.extension().map(|e| e == "db").unwrap_or(false))
        .collect();
    files.sort();
    if files.len() > keep {
        for old in &files[..files.len() - keep] {
            let _ = std::fs::remove_file(old);
        }
    }
    Ok(())
}

// ------------------------------------------------------------------ templates

#[tauri::command]
pub fn list_templates(state: State<AppState>) -> AppResult<Vec<EmailTemplate>> {
    state.db()?.with(templates::list)
}

#[tauri::command]
pub fn create_template(state: State<AppState>, input: EmailTemplateInput) -> AppResult<i64> {
    state.db()?.with_tx(|tx| templates::create(tx, &input))
}

#[tauri::command]
pub fn update_template(
    state: State<AppState>,
    id: i64,
    input: EmailTemplateInput,
) -> AppResult<()> {
    state.db()?.with_tx(|tx| templates::update(tx, id, &input))
}

#[tauri::command]
pub fn delete_template(state: State<AppState>, id: i64) -> AppResult<()> {
    state.db()?.with_tx(|tx| templates::delete(tx, id))
}

/// The placeholders a template may use, for the list beside the editor.
#[tauri::command]
pub fn template_placeholders() -> Vec<Placeholder> {
    templating::CATALOGUE
        .iter()
        .map(|(name, description)| Placeholder {
            name: (*name).to_string(),
            description: (*description).to_string(),
        })
        .collect()
}

/// Renders unsaved editor content against a real policy where the book has one,
/// so the operator sees the message a client would receive.
#[tauri::command]
pub fn preview_template(
    state: State<AppState>,
    subject: String,
    body_html: String,
) -> AppResult<TemplatePreview> {
    state.db()?.with(|conn| {
        let provider = reminders::provider_context(conn)?;
        let sample = reminders::sample_policy(conn)?;
        let (context, sample_policy) = match &sample {
            Some((id, label)) => (
                reminders::policy_context(conn, *id, &provider)?,
                Some(label.clone()),
            ),
            None => (reminders::example_context(&provider), None),
        };

        let html = templating::render(&body_html, &context);
        let mut unknown = templating::unknown_placeholders(&subject);
        for name in templating::unknown_placeholders(&body_html) {
            if !unknown.contains(&name) {
                unknown.push(name);
            }
        }

        Ok(TemplatePreview {
            subject: templating::render(&subject, &context),
            text: mail::to_plain_text(&html),
            html,
            unknown_placeholders: unknown,
            sample_policy,
        })
    })
}

// ------------------------------------------------------------------ reminder rules

#[tauri::command]
pub fn list_rules(state: State<AppState>) -> AppResult<Vec<ReminderRule>> {
    state.db()?.with(rules::list)
}

#[tauri::command]
pub fn create_rule(state: State<AppState>, input: ReminderRuleInput) -> AppResult<i64> {
    state.db()?.with_tx(|tx| rules::create(tx, &input))
}

#[tauri::command]
pub fn update_rule(state: State<AppState>, id: i64, input: ReminderRuleInput) -> AppResult<()> {
    state.db()?.with_tx(|tx| rules::update(tx, id, &input))
}

#[tauri::command]
pub fn delete_rule(state: State<AppState>, id: i64) -> AppResult<()> {
    state.db()?.with_tx(|tx| rules::delete(tx, id))
}

// ------------------------------------------------------------------ reminders

#[tauri::command]
pub fn reminder_overview(state: State<AppState>) -> AppResult<ReminderOverview> {
    state.db()?.with(reminders::overview)
}

/// What the next sweep would do, without writing or sending anything.
#[tauri::command]
pub fn plan_reminders(state: State<AppState>) -> AppResult<Vec<PlannedReminder>> {
    state
        .db()?
        .with(|conn| reminders::plan(conn, util::today()))
}

/// Runs the sweep now. `dryRun` overrides the setting for this run only, which
/// is how the operator tries it out before switching sending on.
#[tauri::command]
pub fn run_reminders(
    app: AppHandle,
    state: State<AppState>,
    dry_run: Option<bool>,
) -> AppResult<ReminderRun> {
    let db = state.db()?;
    let stored_dry_run = db.with(|conn| Ok(settings::get_or(conn, "dry_run", "true") == "true"))?;
    let options = SweepOptions {
        today: util::today(),
        dry_run: dry_run.unwrap_or(stored_dry_run),
    };

    let mailer = if options.dry_run {
        None
    } else {
        let config = db.with(SmtpConfig::load)?;
        if !config.is_usable() {
            return Err(AppError::mail(
                "Add your mail server details in Settings before sending.",
            ));
        }
        Some(Mailer::connect(&config)?)
    };

    let alerter = DesktopAlerts::new(app);
    db.with_tx(|tx| {
        reminders::sweep(
            tx,
            mailer.as_ref().map(|m| m as &dyn reminders::Sender),
            &alerter,
            &options,
        )
    })
}

#[tauri::command]
pub fn list_notifications(
    state: State<AppState>,
    filter: NotificationFilter,
) -> AppResult<Page<Notification>> {
    state.db()?.with(|conn| notifications::list(conn, &filter))
}

#[tauri::command]
pub fn retry_notification(state: State<AppState>, id: i64) -> AppResult<()> {
    state.db()?.with_tx(|tx| notifications::requeue(tx, id))
}

#[tauri::command]
pub fn cancel_notification(state: State<AppState>, id: i64) -> AppResult<()> {
    state.db()?.with_tx(|tx| notifications::cancel(tx, id))
}

/// Stores the mail password in the OS keychain, or clears it when given nothing.
#[tauri::command]
pub fn set_smtp_password(state: State<AppState>, password: Option<String>) -> AppResult<()> {
    // Reading state proves the app is unlocked before touching the keychain.
    let _ = state.db()?;
    match password.filter(|p| !p.is_empty()) {
        Some(secret) => vault::remember_smtp_password(&secret),
        None => vault::forget_smtp_password(),
    }
}

/// Opens a connection and sends one message, so the operator finds out about a
/// wrong password here rather than through a queue full of failures.
#[tauri::command]
pub fn send_test_email(state: State<AppState>, to: String) -> AppResult<()> {
    let address = to.trim().to_string();
    if !util::looks_like_email(&address) {
        return Err(AppError::validation("Enter an email address to test with"));
    }

    let db = state.db()?;
    let config = db.with(SmtpConfig::load)?;
    if !config.is_usable() {
        return Err(AppError::mail(
            "Add the mail server and the address to send from first.",
        ));
    }
    let provider = db.with(reminders::provider_context)?;
    let mailer = Mailer::connect(&config)?;
    mailer.check()?;

    mailer.send(&mail::Outgoing {
        to_name: provider.name.clone(),
        to_email: address,
        subject: "StayInsured test message".into(),
        html: format!(
            "<div style=\"font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px\">\
             <p>This is a test from StayInsured.</p>\
             <p>Mail is going out through <strong>{}</strong> as <strong>{}</strong>, \
             so reminders will reach your clients.</p><p>— {}</p></div>",
            templating::escape_html(&config.host),
            templating::escape_html(&config.from_email),
            templating::escape_html(&provider.name),
        ),
    })
}

#[tauri::command]
pub fn reveal_data_dir(app: AppHandle, state: State<AppState>) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(state.paths.root.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| AppError::other(format!("could not open the folder: {e}")))
}
