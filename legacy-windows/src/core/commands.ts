/**
 * The command surface, matching `src-tauri/src/commands.rs` name for name.
 *
 * The interface reaches the backend through one function — `call<T>()` in
 * `src/lib/api.ts` — so this table is the entire contract. A command name here
 * that the Rust core does not have, or an argument spelled differently, is a
 * screen that breaks.
 *
 * Commands the Rust core allows while locked are the ones that do not call
 * `session.db()`. Everything else refuses with `locked`, which is what sends the
 * interface back to its lock screen.
 *
 * What is not built yet is listed at the bottom and fails saying so. A screen
 * that half works is worse than one that admits it: an operator who cannot
 * import a spreadsheet needs to know that now, not after typing for an hour.
 */

import fs from "node:fs";
import path from "node:path";

import { AppError } from "./errors";
import * as exporter from "./exporter";
import * as importer from "./importer";
import * as clients from "./repo/clients";
import * as dashboard from "./repo/dashboard";
import * as documents from "./repo/documents";
import * as insurers from "./repo/insurers";
import * as members from "./repo/members";
import * as policies from "./repo/policies";
import * as products from "./repo/products";
import * as settings from "./repo/settings";
import type { Session } from "./session";
import type { Client, ClientFilter, ImportOptions } from "./types";
import { CATEGORIES, categoryLabel } from "./util";

type Args = Record<string, unknown>;
type Handler = (session: Session, args: Args) => unknown | Promise<unknown>;

/** Argument readers. A wrong type from the renderer is a bug worth naming. */
function num(args: Args, key: string): number {
  const value = args[key];
  if (typeof value !== "number") throw AppError.other(`${key} must be a number`);
  return value;
}

function str(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw AppError.other(`${key} must be a string`);
  return value;
}

function obj<T>(args: Args, key: string): T {
  const value = args[key];
  if (value === null || typeof value !== "object") throw AppError.other(`${key} must be an object`);
  return value as T;
}

function optBool(args: Args, key: string): boolean {
  return args[key] === true;
}

/** Something is not built. Said in the words of someone using the app. */
function unbuilt(what: string): Handler {
  return () => {
    throw AppError.other(`${what} is not built in the Windows 7 edition yet.`);
  };
}

export const COMMANDS: Record<string, Handler> = {
  // ---------------------------------------------------------------- session
  session_state: (session) => session.state(),
  setup: (session, args) =>
    session.setup(str(args, "password"), args["displayName"] as string | null, optBool(args, "remember")),
  unlock: (session, args) => session.unlock(str(args, "password"), optBool(args, "remember")),
  unlock_with_keychain: (session) => session.unlockWithKeychain(),
  lock: (session) => session.lock(),
  forget_device: (session) => session.forgetDevice(),
  change_password: (session, args) =>
    session.changePassword(str(args, "current"), str(args, "replacement")),

  // ---------------------------------------------------------------- static lookups
  category_options: () =>
    CATEGORIES.map((key, index) => ({ id: index, label: categoryLabel(key), secondary: key })),

  reveal_data_dir: (session) => {
    session.env.reveal(session.paths.root);
  },

  // ---------------------------------------------------------------- dashboard
  load_dashboard: (session) => session.db().with(dashboard.load),
  client_cities: (session) => session.db().with(clients.distinctCities),

  // ---------------------------------------------------------------- clients
  list_clients: (session, args) => session.db().with((conn) => clients.list(conn, obj(args, "filter"))),
  get_client: (session, args) => session.db().with((conn) => clients.get(conn, num(args, "id"))),
  create_client: (session, args) =>
    session.db().withTx((conn) => clients.create(conn, obj(args, "input"))),
  update_client: (session, args) =>
    session.db().withTx((conn) => clients.update(conn, num(args, "id"), obj(args, "input"))),
  set_client_archived: (session, args) =>
    session.db().withTx((conn) => clients.setArchived(conn, num(args, "id"), optBool(args, "archived"))),
  delete_client: (session, args) => session.db().withTx((conn) => clients.remove(conn, num(args, "id"))),
  next_client_code: (session) => session.db().with(clients.nextClientCode),

  // ---------------------------------------------------------------- members
  list_members: (session, args) =>
    session.db().with((conn) => members.listForClient(conn, num(args, "clientId"))),
  create_member: (session, args) =>
    session.db().withTx((conn) => members.create(conn, obj(args, "input"))),
  update_member: (session, args) =>
    session.db().withTx((conn) => members.update(conn, num(args, "id"), obj(args, "input"))),
  delete_member: (session, args) => session.db().withTx((conn) => members.remove(conn, num(args, "id"))),

  // ---------------------------------------------------------------- documents
  list_documents: (session, args) =>
    session.db().with((conn) => documents.listForClient(conn, num(args, "clientId"))),
  attach_document: (session, args) =>
    session.db().withTx((conn) => documents.attach(conn, obj(args, "input"))),
  document_content: (session, args) =>
    session.db().with((conn) => documents.contentForInterface(conn, num(args, "id"))),
  save_document_copy: (session, args) =>
    documents.writeCopy(
      session.db().with((conn) => documents.content(conn, num(args, "id"))),
      str(args, "path"),
    ),
  delete_document: (session, args) =>
    session.db().withTx((conn) => documents.remove(conn, num(args, "id"))),

  // ---------------------------------------------------------------- insurers and plans
  list_insurers: (session, args) =>
    session.db().with((conn) => insurers.list(conn, optBool(args, "includeInactive"))),
  insurer_options: (session) => session.db().with(insurers.lookup),
  create_insurer: (session, args) =>
    session.db().withTx((conn) => insurers.create(conn, obj(args, "input"))),
  update_insurer: (session, args) =>
    session.db().withTx((conn) => insurers.update(conn, num(args, "id"), obj(args, "input"))),
  delete_insurer: (session, args) => session.db().withTx((conn) => insurers.remove(conn, num(args, "id"))),

  list_products: (session, args) =>
    session
      .db()
      .with((conn) =>
        products.list(conn, (args["insurerId"] as number | null) ?? null, optBool(args, "includeInactive")),
      ),
  create_product: (session, args) =>
    session.db().withTx((conn) => products.create(conn, obj(args, "input"))),
  update_product: (session, args) =>
    session.db().withTx((conn) => products.update(conn, num(args, "id"), obj(args, "input"))),
  delete_product: (session, args) => session.db().withTx((conn) => products.remove(conn, num(args, "id"))),

  // ---------------------------------------------------------------- policies
  list_policies: (session, args) => session.db().with((conn) => policies.list(conn, obj(args, "filter"))),
  get_policy: (session, args) => session.db().with((conn) => policies.get(conn, num(args, "id"))),
  policy_chain: (session, args) => session.db().with((conn) => policies.chain(conn, num(args, "id"))),
  policy_member_ids: (session, args) =>
    session.db().with((conn) => policies.membersOf(conn, num(args, "id"))),
  create_policy: (session, args) =>
    session.db().withTx((conn) => policies.create(conn, obj(args, "input"))),
  update_policy: (session, args) =>
    session.db().withTx((conn) => policies.update(conn, num(args, "id"), obj(args, "input"))),
  renew_policy: (session, args) => session.db().withTx((conn) => policies.renew(conn, obj(args, "input"))),
  set_policy_status: (session, args) =>
    session.db().withTx((conn) => policies.setStatus(conn, num(args, "id"), str(args, "status"))),
  delete_policy: (session, args) => session.db().withTx((conn) => policies.remove(conn, num(args, "id"))),
  refresh_statuses: (session) => session.db().withTx(policies.syncStatuses),

  // ---------------------------------------------------------------- import
  //
  // The field list, the preview and the template read a file the operator picked
  // rather than the book, so — as in the Rust core — they answer while the app is
  // locked. Only the import itself needs the database.
  import_fields: () => importer.fieldCatalogue(),
  preview_import: (_session, args) =>
    importer.preview(str(args, "path"), (args["sheet"] as string | null) ?? null),
  run_import: (session, args) => {
    const db = session.db();
    const options = obj<ImportOptions>(args, "options");
    const report = db.with((conn) => importer.run(conn, options));
    // Rows that arrived already expired should say so before the screen redraws.
    if (!(options.dryRun ?? false)) db.withTx(policies.syncStatuses);
    return report;
  },
  write_import_template: (_session, args) => {
    const target = str(args, "path");
    importer.writeTemplate(target);
    return target;
  },

  // ---------------------------------------------------------------- exports
  export_policies: (session, args) =>
    exporter.exportPolicies(
      session.db().with((conn) => policies.listAll(conn, obj(args, "filter"))),
      str(args, "path"),
    ),
  export_clients: (session, args) => {
    // A page at a time, the way `export_clients` in `commands.rs` reads them: the
    // clients list is paginated and clamped at 500 a page, so exporting a book
    // larger than that is several queries rather than one refused one.
    const filter: ClientFilter = { ...obj<ClientFilter>(args, "filter"), page: 1, pageSize: 500 };
    const db = session.db();
    const rows: Client[] = [];
    for (;;) {
      const page = db.with((conn) => clients.list(conn, filter));
      rows.push(...page.rows);
      if (rows.length >= page.total || page.rows.length === 0) break;
      filter.page = (filter.page ?? 1) + 1;
    }
    return exporter.exportClients(rows, str(args, "path"));
  },

  // ---------------------------------------------------------------- settings and backups
  get_settings: (session) => session.db().with(settings.all),
  save_settings: (session, args) =>
    session.db().withTx((conn) => settings.putMany(conn, obj(args, "values"))),
  backup_now: (session) => backupNow(session),

  // ---------------------------------------------------------------- not built yet
  //
  // Each of these has a screen in the interface that will now say plainly that
  // this edition cannot do it. Reminders are the ones that matter most, and they
  // are a sweep of business rules rather than a bridge problem.
  reminder_overview: unbuilt("Reminders"),
  plan_reminders: unbuilt("Reminders"),
  run_reminders: unbuilt("Reminders"),
  list_notifications: unbuilt("Reminders"),
  retry_notification: unbuilt("Reminders"),
  cancel_notification: unbuilt("Reminders"),
  set_smtp_password: unbuilt("Sending email"),
  send_test_email: unbuilt("Sending email"),

  list_templates: unbuilt("Email templates"),
  create_template: unbuilt("Email templates"),
  update_template: unbuilt("Email templates"),
  delete_template: unbuilt("Email templates"),
  preview_template: unbuilt("Email templates"),
  template_placeholders: unbuilt("Email templates"),

  list_rules: unbuilt("Reminder rules"),
  create_rule: unbuilt("Reminder rules"),
  update_rule: unbuilt("Reminder rules"),
  delete_rule: unbuilt("Reminder rules"),
};

/**
 * A snapshot, old ones pruned, mirrored to the configured folder if there is one.
 * The copy is not encrypted here, unlike the app's, so where it is put matters
 * more: a synced folder now means a readable book in the cloud.
 */
function backupNow(session: Session): string {
  const db = session.db();
  const now = new Date();
  const pad = (value: number) => `${value}`.padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const fileName = `stayinsured-${stamp}.db`;
  const local = path.join(session.paths.backups, fileName);
  db.backupTo(local);

  const externalDir = db.with((conn) => settings.getOr(conn, "backup_dir", "")).trim();
  const retention = db.with((conn) => settings.getInt(conn, "backup_retention", 14));

  if (externalDir !== "") {
    try {
      if (fs.statSync(externalDir).isDirectory()) {
        fs.copyFileSync(local, path.join(externalDir, fileName));
      }
    } catch {
      // A backup folder that has gone missing should not lose the local copy that
      // was just taken successfully.
    }
  }

  pruneBackups(session.paths.backups, Math.max(retention, 1));
  return local;
}

function pruneBackups(dir: string, keep: number): void {
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".db"))
    .sort();
  for (const old of files.slice(0, Math.max(files.length - keep, 0))) {
    try {
      fs.rmSync(path.join(dir, old), { force: true });
    } catch {
      // Nothing here is worth failing a successful backup over.
    }
  }
}

/** Runs a command by name, the way `generate_handler!` dispatches one. */
export async function dispatch(session: Session, command: string, args: Args): Promise<unknown> {
  const handler = COMMANDS[command];
  if (!handler) throw AppError.other(`Unknown command: ${command}`);
  const result = await handler(session, args ?? {});
  // `undefined` does not survive the structured clone the way `null` does, and the
  // interface treats a void command's result as nothing either way.
  return result === undefined ? null : result;
}

export function commandNames(): string[] {
  return Object.keys(COMMANDS).sort();
}
