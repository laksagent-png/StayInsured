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
 * No updater. The app's own edition ships signed release artifacts and a
 * `latest.json`; this one is installed by hand and has no update channel, so the
 * check reports nothing available and the interface shows no dialog — which is
 * exactly what it does on a machine that is already current.
 */
export async function check(): Promise<Update | null> {
  return null;
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
