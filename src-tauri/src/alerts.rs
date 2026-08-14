use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::reminders::Alerter;

/// Desktop notifications, for the agent rather than the client. A failure to
/// show one is logged and swallowed: the reminder itself matters more than the
/// banner announcing it, and some Linux desktops have no notification daemon.
pub struct DesktopAlerts {
    app: AppHandle,
}

impl DesktopAlerts {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl Alerter for DesktopAlerts {
    fn alert(&self, title: &str, body: &str) {
        if let Err(err) = self
            .app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()
        {
            tracing::warn!(%err, "could not show a desktop notification");
        }
    }
}
