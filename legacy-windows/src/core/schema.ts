/**
 * The schema, taken from the Rust core rather than copied.
 *
 * `src-tauri/src/db/schema/*.sql` is the one part of the app this edition reuses
 * instead of reimplementing, and reading the files where they live is what keeps
 * that true: a migration added to the core cannot be quietly missing here. The
 * probe and the edition share this module so they cannot disagree about which
 * schema either of them tested.
 */

import fs from "node:fs";
import path from "node:path";

import type BetterSqlite3 from "better-sqlite3";

import { AppError, describe } from "./errors";

/** In the order `db/migrations.rs` applies them. Never reorder a shipped entry. */
export const MIGRATIONS = [
  "001_init.sql",
  "002_seed.sql",
  "003_documents.sql",
  "004_search_index.sql",
  "005_client_relations.sql",
  "006_health_details.sql",
  "007_client_groups.sql",
];

export const LATEST_VERSION = MIGRATIONS.length;

export function userVersion(db: BetterSqlite3.Database): number {
  const [row] = db.pragma("user_version") as { user_version: number }[];
  return row?.user_version ?? 0;
}

/**
 * Mirrors `migrations::apply`: every pending step in one transaction, each
 * stamping `user_version` as it lands. All of it or none of it, so a failure half
 * way through cannot leave a schema no version number describes.
 */
export function applyMigrations(db: BetterSqlite3.Database, schemaDir: string): number {
  const current = userVersion(db);
  if (current >= LATEST_VERSION) return current;

  db.exec("BEGIN");
  try {
    for (const [index, file] of MIGRATIONS.entries()) {
      const version = index + 1;
      if (version <= current) continue;

      const sql = fs.readFileSync(path.join(schemaDir, file), "utf8");
      try {
        db.exec(sql);
      } catch (error) {
        // Which file failed matters more than which statement, since the files are
        // the unit anyone edits.
        throw AppError.other(`migration ${file} failed: ${describe(error)}`);
      }
      // PRAGMA user_version does not accept bound parameters.
      db.exec(`PRAGMA user_version = ${version}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return userVersion(db);
}
