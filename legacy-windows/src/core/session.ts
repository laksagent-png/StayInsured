/**
 * What `vault.rs` and the session commands do, minus the cipher.
 *
 * In the Rust core the password *is* the key: it is stretched with Argon2id and
 * handed to SQLCipher, so a wrong password does not fail a check, it fails to
 * open the file at all. Here the file opens for anyone. The password is verified
 * against an Argon2id hash in the `users` table and the lock is a rule this
 * process keeps, not a property of the data on disk.
 *
 * That difference is the whole cost of reaching Windows 7, and it is not hidden:
 * the lock screen says so, and so does the README. Everything else about the
 * session behaves as the app's does, including which commands are refused while
 * locked, so the interface cannot tell the two apart.
 */

import crypto from "node:crypto";
import fs from "node:fs";

import { argon2id, argon2Verify } from "hash-wasm";

import { Database } from "./db";
import type { AppPaths, CoreEnv } from "./env";
import { AppError } from "./errors";
import { syncStatuses } from "./repo/policies";
import * as settings from "./repo/settings";
import { LATEST_VERSION } from "./schema";

export interface SessionState {
  initialised: boolean;
  unlocked: boolean;
  canUseKeychain: boolean;
  /**
   * False here, and the one field of this edition's state that differs from the
   * Tauri core's. The screens are shared, and several of them promise the operator
   * that their database is encrypted; this edition opens a plain SQLite file, so it
   * says so and they print something true instead.
   */
  encrypted: boolean;
  schemaVersion: number;
  dataDir: string;
}

/** Argon2's `default()` in the `argon2` crate, which is what `hash_password` uses. */
const ARGON2 = { parallelism: 1, iterations: 2, memorySize: 19_456, hashLength: 32 } as const;

async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: crypto.randomBytes(16),
    ...ARGON2,
    outputType: "encoded",
  });
}

export class Session {
  readonly env: CoreEnv;
  private handle: Database | null = null;
  private unlocked = false;

  constructor(env: CoreEnv) {
    this.env = env;
  }

  get paths(): AppPaths {
    return this.env.paths;
  }

  state(): SessionState {
    return {
      initialised: this.initialised(),
      unlocked: this.unlocked,
      canUseKeychain: this.env.secrets.read("device") !== null,
      encrypted: false,
      schemaVersion: LATEST_VERSION,
      dataDir: this.paths.root,
    };
  }

  /**
   * The guard every command that touches data goes through. It refuses for the
   * same 61 commands the Rust core refuses for, so the interface's lock screen
   * and its `locked` error handling work unchanged.
   */
  db(): Database {
    if (!this.unlocked) throw AppError.locked();
    return this.open();
  }

  /**
   * An owner row, not a file on disk, is what marks an installation as set up.
   * The Rust core uses `vault.json` for this and writes it last, so that a crash
   * during setup leaves a fresh install; one transaction here does the same job,
   * because a half-finished setup commits nothing.
   */
  private initialised(): boolean {
    if (!fs.existsSync(this.paths.database)) return false;
    try {
      return this.open().with(
        (conn) => conn.prepare("SELECT 1 FROM users WHERE username = 'owner'").get() !== undefined,
      );
    } catch {
      return false;
    }
  }

  private open(): Database {
    if (!this.handle) this.handle = Database.open(this.paths.database, this.env.schemaDir);
    return this.handle;
  }

  async setup(password: string, displayName?: string | null, remember?: boolean | null): Promise<SessionState> {
    if (this.initialised()) throw AppError.alreadyInitialised();
    if (Array.from(password).length < 8) {
      throw AppError.validation("Use a password of at least 8 characters");
    }

    const name = displayName?.trim() ? displayName.trim() : "Owner";
    const hash = await hashPassword(password);

    this.open().withTx((conn) => {
      settings.put(conn, "provider_name", name);
      conn
        .prepare(
          "INSERT INTO users (username, display_name, password_hash, role) VALUES ('owner', ?, ?, 'owner')",
        )
        .run(name, hash);
    });

    if (remember) this.env.secrets.save("device", "trusted");
    this.unlocked = true;
    return this.state();
  }

  async unlock(password: string, remember?: boolean | null): Promise<SessionState> {
    if (!this.initialised()) throw AppError.other("This installation is not set up yet.");

    const db = this.open();
    const row = db.with(
      (conn) =>
        conn.prepare("SELECT password_hash FROM users WHERE username = 'owner'").get() as
          | { password_hash: string }
          | undefined,
    );

    // In the Rust core this check is belt and braces, because the database had
    // already opened with a key derived from the password. Here it is the only
    // thing standing between a guess and the book.
    if (!row || !(await argon2Verify({ password, hash: row.password_hash }))) {
      throw AppError.badPassword();
    }

    db.with((conn) => {
      conn.prepare("UPDATE users SET last_login_at = datetime('now') WHERE username = 'owner'").run();
      syncStatuses(conn);
    });

    if (remember) this.env.secrets.save("device", "trusted");
    this.unlocked = true;
    return this.state();
  }

  /**
   * "Trust this device." The Rust core keeps the database key in the keychain and
   * an unlock is proof it can open the file. There is no key here, so what is
   * stored is a marker the OS has encrypted for this user account — which grants
   * exactly what an unencrypted database already grants anyone with this login.
   */
  unlockWithKeychain(): SessionState {
    if (this.env.secrets.read("device") === null) throw AppError.locked();
    this.open().with((conn) => syncStatuses(conn));
    this.unlocked = true;
    return this.state();
  }

  lock(): SessionState {
    this.unlocked = false;
    if (this.handle) {
      this.handle.close();
      this.handle = null;
    }
    return this.state();
  }

  forgetDevice(): SessionState {
    this.env.secrets.clear("device");
    return this.state();
  }

  async changePassword(current: string, replacement: string): Promise<void> {
    if (Array.from(replacement).length < 8) {
      throw AppError.validation("Use a password of at least 8 characters");
    }
    const db = this.db();

    const row = db.with(
      (conn) =>
        conn.prepare("SELECT password_hash FROM users WHERE username = 'owner'").get() as
          | { password_hash: string }
          | undefined,
    );
    if (!row || !(await argon2Verify({ password: current, hash: row.password_hash }))) {
      throw AppError.badPassword();
    }

    const hash = await hashPassword(replacement);
    db.with((conn) => {
      conn.prepare("UPDATE users SET password_hash = ? WHERE username = 'owner'").run(hash);
    });

    // Nothing to re-key, and the device marker does not depend on the password,
    // so a changed password leaves a trusted device trusted. The Rust core has to
    // refresh the stored key here because the key itself changed.
  }
}
