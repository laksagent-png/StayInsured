/**
 * What the core needs from the machine, as an interface rather than an import.
 *
 * Nothing under `core/` imports `electron`. That is not tidiness: the tests that
 * hold this edition to the Rust core's behaviour have to run under plain Node in
 * `vitest`, and a module that reaches for `app.getPath` at import time cannot be
 * loaded there at all. `src/env.ts` supplies the Electron implementation and
 * `tests/support.ts` a temporary-directory one.
 */

import fs from "node:fs";
import path from "node:path";

export interface AppPaths {
  root: string;
  database: string;
  backups: string;
  logs: string;
}

/** The accounts `vault.rs` keeps in the OS keychain. */
export type SecretName = "device" | "smtp-password";

export interface SecretStore {
  available(): boolean;
  save(name: SecretName, value: string): boolean;
  read(name: SecretName): string | null;
  clear(name: SecretName): void;
}

export interface CoreEnv {
  paths: AppPaths;
  /** Where `src-tauri/src/db/schema` can be read from, which differs when packaged. */
  schemaDir: string;
  secrets: SecretStore;
  /** Shows a folder to the operator. `reveal_data_dir` in the Rust core. */
  reveal(target: string): void;
  /**
   * Raises a desktop notification, which the sweep does for a rule that alerts
   * rather than emails. `DesktopAlerts` in `alerts.rs`, and as there a failure to
   * show one is swallowed: the reminder matters more than the banner.
   */
  notify(title: string, body: string): void;
}

/** A port of `src-tauri/src/paths.rs`. */
export function appPaths(root: string): AppPaths {
  const paths: AppPaths = {
    root,
    database: path.join(root, "stayinsured.db"),
    backups: path.join(root, "backups"),
    logs: path.join(root, "logs"),
  };
  fs.mkdirSync(paths.backups, { recursive: true });
  fs.mkdirSync(paths.logs, { recursive: true });
  return paths;
}
