mod alerts;
mod commands;
mod db;
mod error;
mod exporter;
mod importer;
mod mail;
mod models;
mod paths;
mod query;
mod reminders;
mod repo;
mod scheduler;
mod state;
mod templating;
#[cfg(test)]
mod tests;
mod tray;
mod util;
mod vault;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use crate::paths::AppPaths;
use crate::state::AppState;

pub fn run() {
    tracing_subscriber::fmt()
        .with_max_level(if cfg!(debug_assertions) {
            tracing::Level::DEBUG
        } else {
            tracing::Level::INFO
        })
        .with_target(false)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .setup(|app| {
            let paths = AppPaths::resolve(app.handle())?;
            tracing::info!(dir = %paths.root.display(), "data directory ready");
            app.manage(AppState::new(paths));
            tray::init(app.handle())?;
            scheduler::start(app.handle().clone());

            // Launched by the OS at login: stay in the tray rather than popping up.
            if std::env::args().any(|arg| arg == "--background") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window parks the app in the tray so scheduled work keeps
            // running; quitting is done from the tray menu.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::session_state,
            commands::setup,
            commands::unlock,
            commands::unlock_with_keychain,
            commands::lock,
            commands::forget_device,
            commands::change_password,
            commands::load_dashboard,
            commands::category_options,
            commands::client_cities,
            commands::list_clients,
            commands::get_client,
            commands::create_client,
            commands::update_client,
            commands::set_client_archived,
            commands::delete_client,
            commands::next_client_code,
            commands::list_members,
            commands::create_member,
            commands::update_member,
            commands::delete_member,
            commands::list_insurers,
            commands::insurer_options,
            commands::create_insurer,
            commands::update_insurer,
            commands::delete_insurer,
            commands::list_products,
            commands::create_product,
            commands::update_product,
            commands::delete_product,
            commands::list_policies,
            commands::get_policy,
            commands::policy_chain,
            commands::policy_member_ids,
            commands::create_policy,
            commands::update_policy,
            commands::renew_policy,
            commands::set_policy_status,
            commands::delete_policy,
            commands::refresh_statuses,
            commands::import_fields,
            commands::preview_import,
            commands::run_import,
            commands::write_import_template,
            commands::export_policies,
            commands::export_clients,
            commands::get_settings,
            commands::save_settings,
            commands::backup_now,
            commands::list_templates,
            commands::create_template,
            commands::update_template,
            commands::delete_template,
            commands::template_placeholders,
            commands::preview_template,
            commands::list_rules,
            commands::create_rule,
            commands::update_rule,
            commands::delete_rule,
            commands::reminder_overview,
            commands::plan_reminders,
            commands::run_reminders,
            commands::list_notifications,
            commands::retry_notification,
            commands::cancel_notification,
            commands::set_smtp_password,
            commands::send_test_email,
            commands::reveal_data_dir,
        ])
        .run(tauri::generate_context!())
        .expect("StayInsured failed to start");
}
