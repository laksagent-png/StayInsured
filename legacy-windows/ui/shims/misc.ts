/**
 * Stands in for the smaller Tauri modules: `api/app`, `api/window`,
 * `plugin-process`, `plugin-updater` and `plugin-autostart`.
 *
 * Each is aliased separately in `vite.config.ts`, and they share a file because
 * one function each is not worth five.
 */

import { bridge } from "../bridge";

// ------------------------------------------------------------ @tauri-apps/api/app

export async function getVersion(): Promise<string> {
  return bridge().version();
}

// --------------------------------------------------------- @tauri-apps/api/window

export interface AppWindow {
  isVisible(): Promise<boolean>;
}

/** Only `isVisible` is used, by the update check deciding whether to interrupt. */
export function getCurrentWindow(): AppWindow {
  return { isVisible: () => bridge().isWindowVisible() };
}

// ------------------------------------------------------ @tauri-apps/plugin-process

export async function relaunch(): Promise<void> {
  return bridge().relaunch();
}

// ------------------------------------------------------ @tauri-apps/plugin-updater

export interface Update {
  version: string;
  downloadAndInstall(): Promise<void>;
}

/**
 * The same offer the app's own edition makes, over this edition's own channel.
 *
 * `src/lib/updates.ts` is shared, so the wording, the once-per-launch rule and the
 * refusal to interrupt a hidden window are the app's and not a second version of
 * them. What differs is underneath: `core/updates.ts` picks the release by tag
 * prefix, because this edition publishes prereleases under `legacy-v*` that
 * `electron-updater` would look straight past, and checks a signature because
 * nothing signs these builds for Windows to check.
 *
 * Null still means what it meant when there was no channel at all: nothing to
 * install, and no dialog. That is also the answer on a Mac, where these builds
 * exist only to catch packaging mistakes.
 */
export async function check(): Promise<Update | null> {
  const found = await bridge().update.check();
  if (found === null) return null;

  return {
    version: found.version,
    // Ends with the installer's own window open and this app closing, because
    // Windows will not replace the files of a running program. The shared flow's
    // restart prompt is therefore never reached, which is the one place the two
    // editions differ in what somebody sees.
    downloadAndInstall: () => bridge().update.install(),
  };
}

// ---------------------------------------------------- @tauri-apps/plugin-autostart

export async function isEnabled(): Promise<boolean> {
  return bridge().autostart.isEnabled();
}

export async function enable(): Promise<void> {
  return bridge().autostart.enable();
}

export async function disable(): Promise<void> {
  return bridge().autostart.disable();
}
