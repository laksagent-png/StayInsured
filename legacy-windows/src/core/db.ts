/**
 * A port of `src-tauri/src/db/mod.rs`, with the encryption taken out.
 *
 * The Rust core opens SQLCipher with a key derived from the password, so the
 * file on disk is unreadable without it. This edition opens a plain file: the
 * password still guards the interface, but anyone holding the disk can read the
 * book. That is the deliberate trade for reaching Windows 7, and it is stated
 * plainly in the interface and the README rather than left for someone to
 * discover.
 *
 * `with` and `withTx` survive the port even though a synchronous SQLite
 * connection needs no mutex, because keeping the shapes identical is what lets
 * a repository function here be read next to its Rust original.
 */

import fs from "node:fs";

import Sqlite from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";

import { AppError } from "./errors";
import { applyMigrations } from "./schema";

export type Conn = BetterSqlite3.Database;

export class Database {
  private readonly handle: Conn;
  readonly schemaVersion: number;

  private constructor(handle: Conn, schemaDir: string) {
    this.handle = handle;
    this.schemaVersion = applyMigrations(handle, schemaDir);
  }

  static open(file: string, schemaDir: string): Database {
    let handle: Conn;
    try {
      handle = new Sqlite(file);
    } catch (error) {
      throw AppError.database(error);
    }

    // The same pragmas the Rust core sets. WAL keeps a read during a write from
    // blocking, and the busy timeout covers the moment the scheduler's sweep
    // overlaps something the operator is doing.
    handle.pragma("journal_mode = WAL");
    handle.pragma("foreign_keys = ON");
    handle.pragma("busy_timeout = 5000");
    handle.pragma("synchronous = NORMAL");

    return new Database(handle, schemaDir);
  }

  with<T>(f: (conn: Conn) => T): T {
    return f(this.handle);
  }

  /**
   * Nested calls become savepoints rather than a second transaction, which is
   * what the importer needs: one transaction for the run, one savepoint per row
   * so a bad row can be dropped without losing the good ones before it.
   */
  withTx<T>(f: (conn: Conn) => T): T {
    return this.handle.transaction(f)(this.handle);
  }

  /**
   * A consistent copy, safe to take while the app is running. VACUUM INTO rather
   * than the online backup API, matching the Rust side so a backup taken by
   * either edition is the same kind of file.
   */
  backupTo(dest: string): void {
    fs.rmSync(dest, { force: true });
    const target = dest.replace(/'/g, "''");
    this.handle.exec(`VACUUM INTO '${target}';`);
  }

  close(): void {
    this.handle.close();
  }
}
