/**
 * A port of `src-tauri/src/mail.rs`: sending through the agency's own mailbox.
 *
 * The agency sends from its own SMTP account rather than a service account of
 * ours, so replies land where the client expects and there is no third party
 * holding the book's contact list.
 *
 * nodemailer stands in for `lettre`, and the settings below are chosen to match
 * what `mail.rs` asks lettre for rather than what nodemailer would default to: a
 * connection pool of ten, a sixty-second limit on every stage of a conversation,
 * and TLS decided by the `smtp_encryption` setting rather than guessed from the
 * port. The one shape that could not be kept is the blocking call — there is no
 * synchronous SMTP in Node — so `send` and `check` are asynchronous here, which
 * is why the sweep is too.
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type SMTPPool from "nodemailer/lib/smtp-pool";

import type { Conn } from "./db";
import { AppError, describe } from "./errors";
import type { SecretStore } from "./env";
import * as settings from "./repo/settings";
import { toPlainText } from "./templating";
import { looksLikeEmail } from "./util";

/**
 * How the connection is protected. `starttls` upgrades a plain connection and is
 * what most providers want on port 587; `tls` is implicit TLS on 465.
 */
export type Encryption = "starttls" | "tls" | "none";

export function parseEncryption(raw: string): Encryption {
  switch (raw.trim().toLowerCase()) {
    case "tls":
    case "ssl":
    case "implicit":
      return "tls";
    case "none":
    case "plain":
    case "":
      return "none";
    default:
      return "starttls";
  }
}

/**
 * lettre's own timeout, which it applies to the connection and to every command
 * in the conversation. nodemailer splits the same idea three ways.
 */
const TIMEOUT_MS = 60_000;

/** `PoolConfig::default()` in lettre, which `SmtpTransport` builds with. */
const MAX_CONNECTIONS = 10;

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
  encryption: Encryption;
}

/**
 * Everything but the password comes from `settings`; the password lives wherever
 * the OS will encrypt it for this user account, which is `vault.rs` in the Rust
 * core and `SecretStore` here.
 */
export function load(conn: Conn, secrets: SecretStore): SmtpConfig {
  const port = settings.getInt(conn, "smtp_port", 587);
  return {
    host: settings.getOr(conn, "smtp_host", "").trim(),
    port: Math.min(Math.max(port, 1), 65_535),
    username: settings.getOr(conn, "smtp_username", "").trim(),
    password: secrets.read("smtp-password") ?? "",
    fromName: settings.getOr(conn, "smtp_from_name", "").trim(),
    fromEmail: settings.getOr(conn, "smtp_from_email", "").trim(),
    encryption: parseEncryption(settings.getOr(conn, "smtp_encryption", "starttls")),
  };
}

/**
 * The minimum needed to attempt a send. Checked before queueing so the operator
 * is told to finish setup instead of collecting failed rows.
 */
export function isUsable(config: SmtpConfig): boolean {
  return config.host !== "" && config.fromEmail !== "";
}

/**
 * The transport as lettre would build it. Separate from `connect` so that what
 * an encryption setting turns into is something a test can read.
 */
export function transportOptions(config: SmtpConfig): SMTPPool.Options {
  return {
    host: config.host,
    port: config.port,
    // Implicit TLS wraps the socket from the first byte; STARTTLS is required
    // rather than merely attempted, so a server that cannot upgrade is a
    // failure instead of a plain-text send nobody was told about.
    secure: config.encryption === "tls",
    requireTLS: config.encryption === "starttls",
    ignoreTLS: config.encryption === "none",
    auth: config.username === "" ? undefined : { user: config.username, pass: config.password },
    pool: true,
    maxConnections: MAX_CONNECTIONS,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  };
}

/** One message ready to go out. */
export interface Outgoing {
  toName: string;
  toEmail: string;
  subject: string;
  html: string;
}

export class Mailer {
  private readonly transport: Transporter;
  private readonly from: { name: string; address: string };

  private constructor(transport: Transporter, from: { name: string; address: string }) {
    this.transport = transport;
    this.from = from;
  }

  static connect(config: SmtpConfig): Mailer {
    if (config.host === "") throw AppError.mail("No mail server is set up yet.");
    // lettre refuses the address while building the mailbox, before a socket is
    // opened. nodemailer would carry it as far as the server and report whatever
    // came back, so the address is checked here to keep the same refusal.
    if (!looksLikeEmail(config.fromEmail)) {
      throw AppError.mail(`\`${config.fromEmail}\` is not a valid address`);
    }

    return new Mailer(nodemailer.createTransport(transportOptions(config)), {
      name: config.fromName === "" ? config.fromEmail : config.fromName,
      address: config.fromEmail,
    });
  }

  /**
   * Opens a connection and authenticates without sending anything, which is what
   * the **Send test** button needs to report a usable answer.
   */
  async check(): Promise<void> {
    let reachable: boolean;
    try {
      reachable = await this.transport.verify();
    } catch (error) {
      throw AppError.mail(explain(error));
    }
    if (!reachable) throw AppError.mail("The mail server refused the connection.");
  }

  async send(message: Outgoing): Promise<void> {
    if (!looksLikeEmail(message.toEmail)) {
      throw AppError.mail(`\`${message.toEmail}\` is not a valid address`);
    }

    try {
      await this.transport.sendMail({
        from: this.from,
        to: { name: message.toName, address: message.toEmail },
        subject: message.subject,
        // Both parts are sent: some clients, and some corporate gateways, will
        // only show the plain text one.
        text: toPlainText(message.html),
        html: message.html,
      });
    } catch (error) {
      throw AppError.mail(explain(error));
    }
  }

  /**
   * What the sweep asks of a mailer, which is all it asks. The `Sender` interface
   * it names lives in `reminders.ts`, as the trait implementation does in
   * `reminders.rs`; structural typing lets the method sit beside `send` here
   * without the two modules having to import each other.
   */
  deliver(message: Outgoing): Promise<void> {
    return this.send(message);
  }

  /**
   * Lets the pooled connections go. In the Rust core this happens when the
   * `Mailer` is dropped at the end of the command; a pool held open here would
   * keep the main process holding sockets it has no further use for.
   */
  close(): void {
    this.transport.close();
  }
}

/**
 * nodemailer's messages, like lettre's, name internals the operator cannot act
 * on, so the common failures are translated into something worth reading. The
 * authentication case is tested first because a rejected password also arrives
 * with a 5xx code, and "wrong password" is the more useful of the two answers.
 */
function explain(error: unknown): string {
  const detail = describe(error);
  const fields = (error ?? {}) as { code?: unknown; responseCode?: unknown };

  if (fields.code === "EAUTH") return "The server rejected the username or password.";
  if (typeof fields.responseCode === "number") {
    if (fields.responseCode >= 400 && fields.responseCode < 500) {
      return `The server asked us to try again later: ${detail}`;
    }
    if (fields.responseCode >= 500 && fields.responseCode < 600) {
      return `The server refused the message: ${detail}`;
    }
  }
  return detail;
}
