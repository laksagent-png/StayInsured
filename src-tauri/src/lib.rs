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

/// Whether a launch belongs in the tray rather than on screen. `--background` is
/// the argument the autostart plugin is registered with, so it means the OS
/// started the app at login and nobody is waiting for a window. It has to be a
/// whole argument: anything that merely resembles the flag was typed by someone
/// who is waiting for one.
pub fn starts_hidden<I: IntoIterator<Item = String>>(args: I) -> bool {
    args.into_iter().any(|arg| arg == "--background")
}

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
        // Registered before anything else, as the plugin requires: a launch that
        // finds the app already running is turned away here, in plugin setup,
        // before this process reaches the data directory or the book. Two
        // processes on one database is a book kept in two places, and the file
        // being encrypted does nothing about it — both launches hold the key.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Someone reached for the app, so the window comes forward exactly as
            // the tray's Open does — which is the whole answer for a copy that
            // started at login and is sitting in the tray. The second launch's
            // own arguments are deliberately not read: a login item firing while
            // the operator has the window open would otherwise hide it on them.
            tray::show_main_window(app);
        }))
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
            if starts_hidden(std::env::args()) {
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
            commands::set_family_archived,
            commands::next_client_code,
            commands::list_relatives,
            commands::client_family,
            commands::link_clients,
            commands::unlink_clients,
            commands::list_groups,
            commands::get_group,
            commands::next_group_code,
            commands::create_group,
            commands::update_group,
            commands::set_group_archived,
            commands::delete_group,
            commands::set_client_group,
            commands::list_documents,
            commands::attach_document,
            commands::document_content,
            commands::save_document_copy,
            commands::delete_document,
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
            commands::policy_insured_ids,
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
