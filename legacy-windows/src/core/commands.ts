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
 */

import fs from "node:fs";
import path from "node:path";

import { AppError } from "./errors";
import * as exporter from "./exporter";
import * as importer from "./importer";
import * as mail from "./mail";
import { Mailer } from "./mail";
import * as reminders from "./reminders";
import * as clients from "./repo/clients";
import * as dashboard from "./repo/dashboard";
import * as documents from "./repo/documents";
import * as insurers from "./repo/insurers";
import * as notifications from "./repo/notifications";
import * as policies from "./repo/policies";
import * as products from "./repo/products";
import * as relations from "./repo/relations";
import * as rules from "./repo/rules";
import * as settings from "./repo/settings";
import * as templates from "./repo/templates";
import type { Session } from "./session";
import * as templating from "./templating";
import type { Client, ClientFilter, DeleteScope, ImportOptions, ReminderRun } from "./types";
import { CATEGORIES, categoryLabel, looksLikeEmail, todayIso } from "./util";

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

/**
 * A flag that may be left unanswered, which is not the same as false: `dryRun`
 * arrives as null when the screen wants whatever Settings says. `Option<bool>` in
 * the Rust handler.
 */
function triStateBool(args: Args, key: string): boolean | null {
  const value = args[key];
  return typeof value === "boolean" ? value : null;
}

/**
 * How much of a family a delete takes. Absent means the narrow answer, matching
 * `Option<DeleteScope>` in the Rust handler; a word neither side recognises is
 * refused rather than read as the destructive one.
 */
function deleteScope(args: Args, key: string): DeleteScope {
  const value = args[key];
  if (value === undefined || value === null) return "linksOnly";
  if (value !== "linksOnly" && value !== "immediateFamily") {
    throw AppError.other(`${key} must be linksOnly or immediateFamily`);
  }
  return value;
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
  // `scope` decides whether the people directly related to this client go too.
  // Anything else is refused rather than guessed at, because both answers destroy
  // something and the difference between them is the point.
  delete_client: (session, args) => {
    const scope = deleteScope(args, "scope");
    return session.db().withTx((conn) => {
      if (scope === "immediateFamily") return clients.removeWithImmediateFamily(conn, num(args, "id"));
      clients.remove(conn, num(args, "id"));
      return [num(args, "id")];
    });
  },
  set_family_archived: (session, args) =>
    session
      .db()
      .withTx((conn) => clients.setFamilyArchived(conn, num(args, "id"), optBool(args, "archived"))),
  next_client_code: (session) => session.db().with(clients.nextClientCode),

  // ---------------------------------------------------------------- family
  list_relatives: (session, args) =>
    session.db().with((conn) => relations.listForClient(conn, num(args, "clientId"))),
  client_family: (session, args) =>
    session.db().with((conn) => relations.family(conn, num(args, "clientId"))),
  link_clients: (session, args) =>
    session.db().withTx((conn) => relations.link(conn, obj(args, "input"))),
  unlink_clients: (session, args) =>
    session
      .db()
      .withTx((conn) =>
        relations.unlink(conn, num(args, "clientId"), num(args, "relatedClientId")),
      ),

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
  policy_insured_ids: (session, args) =>
    session.db().with((conn) => policies.insuredOf(conn, num(args, "id"))),
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

  // ---------------------------------------------------------------- templates
  list_templates: (session) => session.db().with(templates.list),
  create_template: (session, args) =>
    session.db().withTx((conn) => templates.create(conn, obj(args, "input"))),
  update_template: (session, args) =>
    session.db().withTx((conn) => templates.update(conn, num(args, "id"), obj(args, "input"))),
  delete_template: (session, args) =>
    session.db().withTx((conn) => templates.remove(conn, num(args, "id"))),
  // The catalogue is a constant rather than something read out of the book, so the
  // editor can list what a template may say while the app is still locked.
  template_placeholders: () => templating.CATALOGUE,
  preview_template: (session, args) =>
    session.db().with((conn) => templating.preview(conn, str(args, "subject"), str(args, "bodyHtml"))),

  // ---------------------------------------------------------------- reminder rules
  list_rules: (session) => session.db().with(rules.list),
  create_rule: (session, args) => session.db().withTx((conn) => rules.create(conn, obj(args, "input"))),
  update_rule: (session, args) =>
    session.db().withTx((conn) => rules.update(conn, num(args, "id"), obj(args, "input"))),
  delete_rule: (session, args) => session.db().withTx((conn) => rules.remove(conn, num(args, "id"))),

  // ---------------------------------------------------------------- the sweep
  reminder_overview: (session) =>
    session.db().with((conn) => reminders.overview(conn, session.env.secrets)),
  plan_reminders: (session) => session.db().with((conn) => reminders.plan(conn, todayIso())),
  run_reminders: (session, args) => runReminders(session, triStateBool(args, "dryRun")),

  // ---------------------------------------------------------------- the outbox
  list_notifications: (session, args) =>
    session.db().with((conn) => notifications.list(conn, obj(args, "filter"))),
  retry_notification: (session, args) =>
    session.db().withTx((conn) => notifications.requeue(conn, num(args, "id"))),
  cancel_notification: (session, args) =>
    session.db().withTx((conn) => notifications.cancel(conn, num(args, "id"))),

  // ---------------------------------------------------------------- the mail server
  set_smtp_password: (session, args) => {
    // Reading state proves the app is unlocked before touching the keychain.
    session.db();
    const given = args["password"];
    const secret = typeof given === "string" && given !== "" ? given : null;

    if (secret === null) {
      session.env.secrets.clear("smtp-password");
      return;
    }
    if (!session.env.secrets.save("smtp-password", secret)) {
      throw AppError.other(
        "could not save to the OS keychain: this machine has no way to encrypt it.",
      );
    }
  },
  send_test_email: (session, args) => sendTestEmail(session, str(args, "to")),
};

/**
 * Runs the sweep now. `dryRun` overrides the setting for this run only, which is
 * how the operator tries it out before switching sending on.
 */
async function runReminders(session: Session, dryRun: boolean | null): Promise<ReminderRun> {
  const db = session.db();
  const options: reminders.SweepOptions = {
    today: todayIso(),
    dryRun: dryRun ?? db.with((conn) => settings.getOr(conn, "dry_run", "true") === "true"),
  };

  let mailer: Mailer | null = null;
  if (!options.dryRun) {
    const config = db.with((conn) => mail.load(conn, session.env.secrets));
    if (!mail.isUsable(config)) {
      throw AppError.mail("Add your mail server details in Settings before sending.");
    }
    mailer = Mailer.connect(config);
  }

  try {
    return await db.with((conn) =>
      reminders.sweep(conn, mailer, reminders.alerts(session.env), options),
    );
  } finally {
    mailer?.close();
  }
}

/**
 * Opens a connection and sends one message, so the operator finds out about a
 * wrong password here rather than through a queue full of failures.
 */
async function sendTestEmail(session: Session, to: string): Promise<void> {
  const address = to.trim();
  if (!looksLikeEmail(address)) {
    throw AppError.validation("Enter an email address to test with");
  }

  const db = session.db();
  const config = db.with((conn) => mail.load(conn, session.env.secrets));
  if (!mail.isUsable(config)) {
    throw AppError.mail("Add the mail server and the address to send from first.");
  }
  const provider = db.with(templating.providerContext);

  const mailer = Mailer.connect(config);
  try {
    await mailer.check();
    await mailer.send({
      toName: provider.name,
      toEmail: address,
      subject: "StayInsured test message",
      html:
        '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px">' +
        "<p>This is a test from StayInsured.</p>" +
        `<p>Mail is going out through <strong>${templating.escapeHtml(config.host)}</strong> as ` +
        `<strong>${templating.escapeHtml(config.fromEmail)}</strong>, ` +
        "so reminders will reach your clients.</p>" +
        `<p>— ${templating.escapeHtml(provider.name)}</p></div>`,
    });
  } finally {
    mailer.close();
  }
}

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
