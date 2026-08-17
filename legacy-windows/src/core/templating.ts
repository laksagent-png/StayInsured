/**
 * A port of `src-tauri/src/templating.rs`: placeholder substitution for the
 * message templates.
 *
 * `{{name}}` inserts an escaped value; `{{{name}}}` inserts raw HTML and is
 * reserved for values the app builds itself, such as the digest table. A
 * placeholder that resolves to nothing becomes an empty string rather than being
 * left in the message, because `{{client_name}}` arriving in a client's inbox is
 * worse than a gap.
 *
 * Two things the Rust core keeps elsewhere live here as well, because the preview
 * command needs them and their Rust homes belong to the mail sweep:
 * `policyContext` and friends come from `reminders.rs`, and `toPlainText` from
 * `mail.rs`. Both are rendering rather than sending — turning a book row and an
 * HTML body into what the client would read — so the sweep imports them from here
 * instead of a second copy existing.
 */

import type { Conn } from "./db";
import { AppError } from "./errors";
import * as settings from "./repo/settings";
import type { Placeholder, TemplatePreview } from "./types";
import { addDays, categoryLabel, daysUntil, formatDate, formatMoney, todayIso } from "./util";

/**
 * Every placeholder a template may use, with the description shown beside it in
 * the editor. Kept here so the editor and the renderer cannot disagree.
 *
 * A list of pairs rather than an object keyed by name: membership decides whether
 * the editor calls a placeholder a typo, and every object also answers for
 * `constructor` and `toString` with something inherited.
 */
export const CATALOGUE: readonly Placeholder[] = [
  { name: "client_name", description: "The client's full name" },
  { name: "client_code", description: "Their code, such as CL-00001" },
  { name: "client_email", description: "The address the message is going to" },
  { name: "client_phone", description: "Their phone number" },
  { name: "policy_number", description: "The policy number" },
  { name: "category_label", description: "Health, Motor, Life and so on" },
  { name: "insurer_name", description: "The insurer" },
  { name: "product_name", description: "The plan name" },
  { name: "start_date", description: "When the current year started" },
  { name: "expiry_date", description: "When cover ends" },
  { name: "days_to_expiry", description: "Whole days until expiry, negative once past" },
  { name: "policy_year", description: "How many years this cover has run" },
  { name: "sum_insured", description: "Sum insured, formatted as money" },
  { name: "premium_amount", description: "Premium, formatted as money" },
  { name: "nominee_name", description: "The nominee on the policy" },
  { name: "vehicle_number", description: "Registration number, for motor policies" },
  { name: "provider_name", description: "Your agency name" },
  { name: "provider_email", description: "Your agency email" },
  { name: "provider_phone", description: "Your agency phone" },
  { name: "provider_address", description: "Your agency address" },
  { name: "today", description: "Today's date" },
  { name: "expiring_count", description: "How many policies the digest covers" },
  { name: "digest_table", description: "The digest table itself, as HTML" },
];

/** Values a template can draw on. Missing keys render as empty. */
export class Context {
  private readonly values = new Map<string, string>();

  set(key: string, value: string): this {
    this.values.set(key, value);
    return this;
  }

  /**
   * Convenience for optional columns, where absent should mean empty rather than
   * the word "null".
   */
  setOpt(key: string, value: string | null | undefined): this {
    this.values.set(key, value ?? "");
    return this;
  }

  get(key: string): string | undefined {
    return this.values.get(key);
  }
}

export function render(template: string, context: Context): string {
  let out = "";
  let i = 0;

  while (i < template.length) {
    if (!template.startsWith("{{", i)) {
      out += template[i];
      i += 1;
      continue;
    }

    const raw = template.startsWith("{{{", i);
    const open = raw ? 3 : 2;
    const close = raw ? "}}}" : "}}";

    const end = template.indexOf(close, i + open);
    // An unclosed brace is left exactly as written rather than eating the rest of
    // the template.
    if (end === -1) {
      out += "{";
      i += 1;
      continue;
    }

    const value = context.get(template.slice(i + open, end).trim()) ?? "";
    out += raw ? value : escapeHtml(value);
    i = end + close.length;
  }

  return out;
}

/**
 * The placeholders a template actually uses, in the order they appear, without
 * duplicates. Used to warn about names that resolve to nothing.
 */
export function placeholdersUsed(template: string): string[] {
  const found: string[] = [];
  let rest = template;

  for (;;) {
    const start = rest.indexOf("{{");
    if (start === -1) break;

    const after = rest.slice(start);
    const raw = after.startsWith("{{{");
    const open = raw ? 3 : 2;
    const close = raw ? "}}}" : "}}";

    const end = after.indexOf(close, open);
    if (end === -1) break;

    const key = after.slice(open, end).trim();
    if (key !== "" && !found.includes(key)) found.push(key);
    rest = after.slice(end + close.length);
  }

  return found;
}

/**
 * Names that are not in the catalogue, so the editor can point at a typo before
 * it goes out to a client.
 */
export function unknownPlaceholders(template: string): string[] {
  return placeholdersUsed(template).filter((key) => !CATALOGUE.some((entry) => entry.name === key));
}

export function escapeHtml(value: string): string {
  let out = "";
  for (const char of value) {
    switch (char) {
      case "&":
        out += "&amp;";
        break;
      case "<":
        out += "&lt;";
        break;
      case ">":
        out += "&gt;";
        break;
      case '"':
        out += "&quot;";
        break;
      case "'":
        out += "&#39;";
        break;
      default:
        out += char;
    }
  }
  return out;
}

/** Tags that end a line in the text part, keeping the shape of the message. */
const BLOCK_TAGS = new Set(["br", "p", "div", "tr", "li", "h1", "h2", "h3", "table"]);

/**
 * A readable plain-text fallback from the HTML body. Block-level tags become line
 * breaks so the text keeps the shape of the message rather than running into one
 * paragraph. `mail::to_plain_text` in the Rust core.
 */
export function toPlainText(html: string): string {
  let out = "";
  let i = 0;

  while (i < html.length) {
    const char = html[i]!;
    i += 1;
    if (char !== "<") {
      out += char;
      continue;
    }

    let tag = "";
    while (i < html.length) {
      const inner = html[i]!;
      i += 1;
      if (inner === ">") break;
      tag += inner;
    }

    const closing = tag.startsWith("/");
    const name = (/^[A-Za-z0-9]*/.exec(tag.replace(/^\/+/, "")) ?? [""])[0]!.toLowerCase();

    if (BLOCK_TAGS.has(name)) {
      out += "\n";
    } else if ((name === "td" || name === "th") && !closing) {
      // Only the opening tag separates cells, or every row would come out with
      // the columns double-spaced.
      out += "\t";
    }
  }

  const decoded = out
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const lines: string[] = [];
  for (const line of decoded.split(/\r?\n/)) {
    const trimmed = line.trim();
    // Collapse runs of blank lines left behind by nested tags.
    if (trimmed === "" && (lines.length === 0 || lines[lines.length - 1] === "")) continue;
    lines.push(trimmed);
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/** The agency's own details, needed by every message. */
export interface Provider {
  name: string;
  email: string;
  phone: string;
  address: string;
  dateFormat: string;
  currency: string;
}

export function providerContext(conn: Conn): Provider {
  return {
    name: settings.getOr(conn, "provider_name", "Your agency"),
    email: settings.getOr(conn, "provider_email", ""),
    phone: settings.getOr(conn, "provider_phone", ""),
    address: settings.getOr(conn, "provider_address", ""),
    dateFormat: settings.getOr(conn, "date_format", "dd/MM/yyyy"),
    currency: settings.getOr(conn, "currency", "INR"),
  };
}

interface OverviewRow {
  client_name: string;
  client_code: string;
  client_email: string | null;
  client_phone: string | null;
  policy_number: string;
  category: string;
  insurer_name: string;
  product_name: string | null;
  start_date: string;
  expiry_date: string;
  policy_year: number;
  sum_insured: number | null;
  premium_amount: number | null;
  nominee_name: string | null;
  vehicle_number: string | null;
}

/** Fills every placeholder the catalogue offers for one policy. */
export function policyContext(conn: Conn, policyId: number, provider: Provider): Context {
  const context = new Context();
  context
    .set("provider_name", provider.name)
    .set("provider_email", provider.email)
    .set("provider_phone", provider.phone)
    .set("provider_address", provider.address)
    .set("today", formatDate(todayIso(), provider.dateFormat));

  const row = conn
    .prepare(
      "SELECT client_name, client_code, client_email, client_phone, policy_number, category, " +
        "insurer_name, product_name, start_date, expiry_date, policy_year, sum_insured, " +
        "premium_amount, nominee_name, vehicle_number " +
        "FROM policy_overview WHERE id = ?",
    )
    .get(policyId) as OverviewRow | undefined;
  if (!row) throw AppError.notFound("Policy");

  const money = (value: number | null) => (value === null ? "" : formatMoney(value, provider.currency));

  context
    .set("client_name", row.client_name)
    .set("client_code", row.client_code)
    .setOpt("client_email", row.client_email)
    .setOpt("client_phone", row.client_phone)
    .set("policy_number", row.policy_number)
    .set("category_label", categoryLabel(row.category))
    .set("insurer_name", row.insurer_name)
    .setOpt("product_name", row.product_name)
    .set("start_date", formatDate(row.start_date, provider.dateFormat))
    .set("expiry_date", formatDate(row.expiry_date, provider.dateFormat))
    .set("days_to_expiry", `${daysUntil(row.expiry_date) ?? 0}`)
    .set("policy_year", `${row.policy_year}`)
    .set("sum_insured", money(row.sum_insured))
    .set("premium_amount", money(row.premium_amount))
    .setOpt("nominee_name", row.nominee_name)
    .setOpt("vehicle_number", row.vehicle_number);

  return context;
}

/**
 * A real policy to preview a template against, preferring one that expires soon
 * so the sample reads like the messages that actually go out.
 */
export function samplePolicy(conn: Conn): { id: number; label: string } | null {
  const row = conn
    .prepare(
      "SELECT id, policy_number || ' · ' || client_name AS label FROM policy_overview " +
        "ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, expiry_date LIMIT 1",
    )
    .get() as { id: number; label: string } | undefined;
  return row ?? null;
}

/** Stand-in values so a template can be previewed before any policy exists. */
export function exampleContext(provider: Provider): Context {
  const context = new Context();
  const expiry = daysFromToday(30);
  const started = daysFromToday(30 - 365);

  return context
    .set("client_name", "Ananya Sharma")
    .set("client_code", "CL-00001")
    .set("client_email", "ananya.sharma@example.com")
    .set("client_phone", "9876543210")
    .set("policy_number", "SH/2026/884213")
    .set("category_label", "Health")
    .set("insurer_name", "Star Health and Allied Insurance")
    .set("product_name", "Family Health Optima")
    .set("start_date", formatDate(started, provider.dateFormat))
    .set("expiry_date", formatDate(expiry, provider.dateFormat))
    .set("days_to_expiry", "30")
    .set("policy_year", "3")
    .set("sum_insured", formatMoney(1_000_000, provider.currency))
    .set("premium_amount", formatMoney(24_500, provider.currency))
    .set("nominee_name", "Rohit Sharma")
    .set("vehicle_number", "")
    .set("provider_name", provider.name)
    .set("provider_email", provider.email)
    .set("provider_phone", provider.phone)
    .set("provider_address", provider.address)
    .set("today", formatDate(todayIso(), provider.dateFormat))
    .set("expiring_count", "12")
    .set(
      "digest_table",
      '<table cellpadding="6" style="border-collapse:collapse;font-size:14px">' +
        "<tr><td>Ananya Sharma</td><td>SH/2026/884213</td><td>Expires in 30 days</td></tr></table>",
    );
}

function daysFromToday(days: number): string {
  const iso = addDays(todayIso(), days);
  if (iso === null) throw AppError.other("today's date is unreadable");
  return iso;
}

/**
 * Renders unsaved editor content against a real policy where the book has one, so
 * the operator sees the message a client would receive. `preview_template` in
 * `commands.rs` does this inline; it sits here so the command table stays a table.
 */
export function preview(conn: Conn, subject: string, bodyHtml: string): TemplatePreview {
  const provider = providerContext(conn);
  const sample = samplePolicy(conn);
  const context = sample ? policyContext(conn, sample.id, provider) : exampleContext(provider);

  const html = render(bodyHtml, context);
  const unknown = unknownPlaceholders(subject);
  for (const name of unknownPlaceholders(bodyHtml)) {
    if (!unknown.includes(name)) unknown.push(name);
  }

  return {
    subject: render(subject, context),
    html,
    text: toPlainText(html),
    unknownPlaceholders: unknown,
    samplePolicy: sample?.label ?? null,
  };
}
