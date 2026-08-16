/**
 * The Electron half of `core/env.ts`: everything the core needs from the machine
 * it is running on, and the only place outside `main.ts` that imports Electron.
 *
 * The secret store is what `vault.rs` uses the OS keychain for. `keytar` would be
 * the closer match to the `keyring` crate, but it is a native module, and native
 * modules are the hard part on Windows 7 — the thing this whole edition exists to
 * avoid betting on twice. `safeStorage` is built into Electron and wraps DPAPI on
 * Windows and the Keychain on macOS, so a secret written here cannot be read by
 * another user account or carried to another machine, which is the property that
 * matters. A machine that cannot encrypt simply asks for the password every time.
 */

import { app, safeStorage, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

import { appPaths, type CoreEnv, type SecretName, type SecretStore } from "./core/env";

/**
 * A packaged build carries the schema as an extra resource; a dev run reads it out
 * of the Rust tree, so the two editions cannot drift apart unnoticed.
 */
export function schemaDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "schema")
    : path.join(__dirname, "..", "..", "src-tauri", "src", "db", "schema");
}

function secretStore(secretsDir: string): SecretStore {
  fs.mkdirSync(secretsDir, { recursive: true });
  const fileFor = (name: SecretName) => path.join(secretsDir, `${name}.bin`);

  const available = () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  };

  return {
    available,

    save(name, value) {
      if (!available()) return false;
      try {
        fs.writeFileSync(fileFor(name), safeStorage.encryptString(value));
        return true;
      } catch {
        return false;
      }
    },

    read(name) {
      if (!available()) return null;
      try {
        const file = fileFor(name);
        if (!fs.existsSync(file)) return null;
        return safeStorage.decryptString(fs.readFileSync(file));
      } catch {
        // A secret written by another account, or on another machine, decrypts to
        // nothing useful. Treat it as absent rather than as an error.
        return null;
      }
    },

    clear(name) {
      fs.rmSync(fileFor(name), { force: true });
    },
  };
}

export function electronEnv(): CoreEnv {
  // Electron derives this folder from this project's name, so it is not the app's.
  // One book must never be opened by both editions: the Rust core's file is
  // encrypted and this one's is not.
  const root = app.getPath("userData");

  return {
    paths: appPaths(root),
    schemaDir: schemaDir(),
    secrets: secretStore(path.join(root, "secrets")),
    reveal: (target) => {
      void shell.openPath(target);
    },
  };
}
