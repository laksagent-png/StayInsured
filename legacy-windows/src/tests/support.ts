/**
 * The `TempDb` of `src-tauri/src/tests.rs`, and the same two sample records, so a
 * test here can be read beside the Rust test it is holding this edition to.
 *
 * The environment is a temporary directory and a secret store in a Map. Nothing
 * reaches Electron, which is what lets these run under `ELECTRON_RUN_AS_NODE`.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Database, type Conn } from "../core/db";
import { appPaths, type CoreEnv, type SecretName, type SecretStore } from "../core/env";
import * as clients from "../core/repo/clients";
import * as insurers from "../core/repo/insurers";
import * as policies from "../core/repo/policies";
import * as settings from "../core/repo/settings";
import { Session } from "../core/session";
import type {
  ClientInput,
  EmailTemplateInput,
  PolicyInput,
  ReminderRuleInput,
} from "../core/types";
import { addDays, todayIso } from "../core/util";

/**
 * The schema the Rust core owns. Read from the same files rather than copied, so
 * a migration added there is applied here without anyone remembering to.
 */
export function schemaDir(): string {
  return path.join(__dirname, "..", "..", "..", "src-tauri", "src", "db", "schema");
}

const created: string[] = [];

/**
 * `TempDb::dir` in the Rust tests: somewhere to write a fixture to import or
 * attach, or a file to export to. Removed with the rest at the end of the run.
 */
export function tempDir(label: string): string {
  const dir = path.join(os.tmpdir(), `stayinsured-legacy-${label}-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  created.push(dir);
  return dir;
}

/** Removes every directory the run created. Called by the runner at the end. */
export function cleanUp(): void {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
  created.length = 0;
}

/** A secret store that behaves like an available keychain, held in memory. */
export function fakeSecrets(): SecretStore & { store: Map<SecretName, string> } {
  const store = new Map<SecretName, string>();
  return {
    store,
    available: () => true,
    save(name, value) {
      store.set(name, value);
      return true;
    },
    read: (name) => store.get(name) ?? null,
    clear(name) {
      store.delete(name);
    },
  };
}

export interface TestEnv extends CoreEnv {
  secrets: ReturnType<typeof fakeSecrets>;
  /** What `reveal_data_dir` was asked to show, for the one test that checks it. */
  revealed: string[];
}

export function tempEnv(label: string): TestEnv {
  const revealed: string[] = [];
  return {
    paths: appPaths(tempDir(label)),
    schemaDir: schemaDir(),
    secrets: fakeSecrets(),
    revealed,
    reveal: (target) => revealed.push(target),
  };
}

/** A migrated, empty database on its own file. `TempDb::new` in the Rust tests. */
export function tempDb(label: string): Database {
  return Database.open(path.join(tempDir(label), "test.db"), schemaDir());
}

/** A session already past the password wall, and the environment behind it. */
export async function unlockedSession(label: string): Promise<{ session: Session; env: TestEnv }> {
  const env = tempEnv(label);
  const session = new Session(env);
  await session.setup("correct horse battery", "Sunrise Insurance Services", false);
  return { session, env };
}

export function sampleClient(name: string): ClientInput {
  return {
    fullName: name,
    email: `${name.toLowerCase().replace(/ /g, ".")}@example.com`,
    phone: "98765 43210",
    city: "Pune",
  };
}

export function samplePolicy(
  clientId: number,
  insurerId: number,
  number: string,
  expiry: string,
): PolicyInput {
  return {
    policyNumber: number,
    clientId,
    insurerId,
    category: "health",
    startDate: "2026-04-01",
    expiryDate: expiry,
    sumInsured: 1_000_000,
    premiumAmount: 24_500,
    commissionRate: 15,
  };
}

export function sampleTemplate(name: string): EmailTemplateInput {
  return {
    name,
    trigger: "expiry_reminder",
    subject: "Your policy expires on {{expiry_date}}",
    bodyHtml: "<p>Dear {{client_name}},</p>",
    isActive: true,
  };
}

/** A rule the seeded ladder does not already have, so it can be placed and moved. */
export function sampleRule(name: string, templateId: number): ReminderRuleInput {
  return {
    name,
    offsetDays: 45,
    category: null,
    audience: "client",
    channel: "email",
    templateId,
    isActive: true,
  };
}

/** `util::iso(util::today() + Duration::days(n))` in the Rust tests. */
export function daysFromToday(days: number): string {
  const iso = addDays(todayIso(), days);
  if (iso === null) throw new Error("today is unreadable, which cannot happen");
  return iso;
}

/** Reads a single value out of a query, for the assertions that go around a repo. */
export function scalar<T>(conn: Conn, sql: string, ...params: unknown[]): T {
  const row = conn.prepare(sql).get(...(params as never[])) as Record<string, T>;
  return Object.values(row)[0] as T;
}

/**
 * A book with one client whose only policy expires in exactly `days`, and the
 * agency named. `book_expiring_in` in the Rust tests, which every reminder case
 * starts from.
 */
export function bookExpiringIn(
  db: Database,
  days: number,
  email: string | null,
): { clientId: number; policyId: number } {
  return db.withTx((conn) => {
    const input = sampleClient("Ananya Sharma");
    input.email = email;
    const clientId = clients.create(conn, input);
    const insurerId = insurers.findOrCreate(conn, "Star Health and Allied Insurance");
    const policyId = policies.create(
      conn,
      samplePolicy(clientId, insurerId, "SH/2026/884213", daysFromToday(days)),
    );
    settings.put(conn, "provider_name", "Sunrise Insurance Services");
    settings.put(conn, "digest_enabled", "false");
    return { clientId, policyId };
  });
}
