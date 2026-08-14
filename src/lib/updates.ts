import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

let checked = false;

/**
 * Looks for a newer release once per launch and offers to install it.
 *
 * Nothing is shown unless there is something to install: a laptop that is
 * offline, or already current, sees no dialog at all. The check is skipped
 * while the window is hidden, because the app is launched at login into the
 * tray, and a dialog appearing over someone's desktop at startup is the kind
 * of interruption that gets an app quit rather than updated.
 */
export async function offerUpdate(): Promise<void> {
  if (checked) return;
  checked = true;

  try {
    if (!(await getCurrentWindow().isVisible())) return;

    const update = await check();
    if (!update) return;

    const install = await ask(
      `StayInsured ${update.version} is available. You are running ${await getVersion()}.\n\n` +
        "Your clients, policies and settings stay exactly as they are; only the app is replaced.",
      { title: "Update available", kind: "info", okLabel: "Install now", cancelLabel: "Later" },
    );
    if (!install) return;

    await update.downloadAndInstall();

    const now = await ask("StayInsured is updated. Restart to finish?", {
      title: "Update installed",
      kind: "info",
      okLabel: "Restart now",
      cancelLabel: "Later",
    });
    if (now) await relaunch();
  } catch (err) {
    // An update check is never the reason to interrupt someone's morning: a
    // missing network, a GitHub outage or an unreadable release file all just
    // mean the offer waits until the next launch.
    console.warn("update check failed", err);
  }
}
