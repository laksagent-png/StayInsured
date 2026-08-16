/**
 * The Windows 7 gate.
 *
 * A parallel Electron edition is only worth planning if three things hold on a
 * Windows 7 machine: Electron 22 starts, the `better-sqlite3` native module
 * loads, and the app's real schema applies to a plain SQLite file. This checks
 * all three and reports what it found, so a run on an old machine answers the
 * question rather than raising new ones.
 */

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import type BetterSqlite3 from "better-sqlite3";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ProbeReport {
  environment: Record<string, string>;
  checks: Check[];
  reportPath: string;
}

/** The migrations the Rust core applies, in the order `migrations.rs` applies them. */
const MIGRATIONS = ["001_init.sql", "002_seed.sql", "003_documents.sql"];
const LATEST_VERSION = MIGRATIONS.length;

/**
 * The schema is read from the Rust core rather than copied into this project,
 * so the probe cannot pass against a schema the app has since moved on from.
 * A packaged build carries the files as an extra resource; a dev run reads them
 * where they live.
 */
function schemaDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "schema")
    : path.join(__dirname, "..", "..", "src-tauri", "src", "db", "schema");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function runProbe(): ProbeReport {
  const checks: Check[] = [];
  const userData = app.getPath("userData");
  const dbPath = path.join(userData, "probe.db");
  const reportPath = path.join(userData, "probe-report.json");

  const environment: Record<string, string> = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    // On Windows this is the kernel version, which is how to tell a genuine
    // Windows 7 (6.1) run from a modern machine pretending to be one.
    release: require("node:os").release(),
    userData,
  };

  let Sqlite: typeof BetterSqlite3 | undefined;
  try {
    // Required here rather than imported at the top of the file: a native
    // module that will not load should become a reported failure, not a crash
    // before there is a window to report it in.
    Sqlite = require("better-sqlite3") as typeof BetterSqlite3;
    checks.push({
      name: "better-sqlite3 native module loads",
      ok: true,
      detail: require.resolve("better-sqlite3"),
    });
  } catch (error) {
    checks.push({
      name: "better-sqlite3 native module loads",
      ok: false,
      detail: describe(error),
    });
  }

  if (!Sqlite) {
    // Nothing below can run without the module, and a half-finished report is
    // more confusing than a short one.
    return finish({ environment, checks, reportPath });
  }

  // A stale file from an earlier run would let a broken migration pass.
  try {
    fs.rmSync(dbPath, { force: true });
  } catch (error) {
    checks.push({ name: "previous probe database removed", ok: false, detail: describe(error) });
  }

  let db: BetterSqlite3.Database | undefined;
  try {
    db = new Sqlite(dbPath);
    const sqliteVersion = db.prepare("SELECT sqlite_version() AS v").get() as { v: string };
    checks.push({
      name: "plain SQLite file opens",
      ok: true,
      detail: `SQLite ${sqliteVersion.v} at ${dbPath}`,
    });
  } catch (error) {
    checks.push({ name: "plain SQLite file opens", ok: false, detail: describe(error) });
    return finish({ environment, checks, reportPath });
  }

  try {
    db.pragma("foreign_keys = ON");
    const [{ foreign_keys: enabled }] = db.pragma("foreign_keys") as { foreign_keys: number }[];
    checks.push({
      name: "foreign keys enforced",
      ok: enabled === 1,
      detail: `PRAGMA foreign_keys = ${enabled}`,
    });
  } catch (error) {
    checks.push({ name: "foreign keys enforced", ok: false, detail: describe(error) });
  }

  checks.push(applyMigrations(db));
  checks.push(countObjects(db));
  checks.push(writeAndReadBack(db));

  db.close();
  return finish({ environment, checks, reportPath });
}

/** Mirrors `db/migrations.rs`: apply each file in order, then stamp the version. */
function applyMigrations(db: BetterSqlite3.Database): Check {
  const directory = schemaDir();
  try {
    const [{ user_version: current }] = db.pragma("user_version") as { user_version: number }[];

    for (const [index, file] of MIGRATIONS.entries()) {
      const version = index + 1;
      if (version <= current) continue;

      const sql = fs.readFileSync(path.join(directory, file), "utf8");
      db.exec("BEGIN");
      try {
        db.exec(sql);
        db.exec(`PRAGMA user_version = ${version}`);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw new Error(`${file}: ${describe(error)}`);
      }
    }

    const [{ user_version: applied }] = db.pragma("user_version") as { user_version: number }[];
    return {
      name: "the app's real schema applies",
      ok: applied === LATEST_VERSION,
      detail: `user_version ${applied} of ${LATEST_VERSION}, from ${directory}`,
    };
  } catch (error) {
    return { name: "the app's real schema applies", ok: false, detail: describe(error) };
  }
}

/** Reads in the order someone would ask about them, not alphabetically. */
const OBJECT_LABELS: [type: string, one: string, many: string][] = [
  ["table", "table", "tables"],
  ["view", "view", "views"],
  ["index", "index", "indexes"],
  ["trigger", "trigger", "triggers"],
];

function countObjects(db: BetterSqlite3.Database): Check {
  try {
    const rows = db
      .prepare(
        "SELECT type, COUNT(*) AS n FROM sqlite_master WHERE type IN ('table','view','index','trigger') GROUP BY type",
      )
      .all() as { type: string; n: number }[];

    const counts = new Map(rows.map((row) => [row.type, row.n]));
    const summary = OBJECT_LABELS.filter(([type]) => (counts.get(type) ?? 0) > 0)
      .map(([type, one, many]) => {
        const n = counts.get(type) ?? 0;
        return `${n} ${n === 1 ? one : many}`;
      })
      .join(", ");

    const tables = counts.get("table") ?? 0;
    return { name: "schema objects created", ok: tables > 0, detail: summary || "nothing created" };
  } catch (error) {
    return { name: "schema objects created", ok: false, detail: describe(error) };
  }
}

/**
 * Writes a row the way the app would and reads it back. This is what proves the
 * column defaults work — `created_at` and `preferred_language` come from the
 * DDL rather than from any code, so a value in them means SQLite honoured it.
 */
function writeAndReadBack(db: BetterSqlite3.Database): Check {
  try {
    db.prepare("INSERT INTO clients (client_code, full_name, city) VALUES (?, ?, ?)").run(
      "CL-00001",
      "Probe Client",
      "Pune",
    );

    const row = db
      .prepare("SELECT client_code, full_name, preferred_language, created_at FROM clients WHERE client_code = ?")
      .get("CL-00001") as
      | { client_code: string; full_name: string; preferred_language: string; created_at: string }
      | undefined;

    if (!row) {
      return { name: "a client writes and reads back", ok: false, detail: "the row was not found again" };
    }

    const defaultsHeld = row.preferred_language === "en" && row.created_at.length > 0;
    return {
      name: "a client writes and reads back",
      ok: defaultsHeld,
      detail: `${row.full_name} (${row.client_code}), language ${row.preferred_language}, created ${row.created_at}`,
    };
  } catch (error) {
    return { name: "a client writes and reads back", ok: false, detail: describe(error) };
  }
}

/**
 * Leaves the report on disk as well as on screen, so a run on someone else's
 * Windows 7 machine can be sent back as a file rather than a description.
 */
function finish(report: ProbeReport): ProbeReport {
  try {
    fs.writeFileSync(report.reportPath, JSON.stringify(report, null, 2), "utf8");
  } catch {
    // A report that cannot be saved is still worth showing.
  }
  return report;
}
