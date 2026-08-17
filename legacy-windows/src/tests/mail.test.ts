/**
 * The mail server settings, and what they turn into.
 *
 * There is no SMTP server in a test run and nothing here opens a socket. What can
 * be held to `mail.rs` without one is the part most likely to be wrong on an
 * agency's machine: where the password comes from, whether a port of 465 is
 * wrapped in TLS or upgraded into it, and which half-finished settings are refused
 * before a queue fills up with failures. Delivery itself is exercised through the
 * `Sender` seam in `reminders.test.ts`, the way the Rust tests do it.
 *
 * The plain-text part of a message is `toPlainText`, which lives in `templating.ts`
 * and is checked in `templates.test.ts`.
 */

import {
  isUsable,
  load,
  Mailer,
  parseEncryption,
  transportOptions,
  type SmtpConfig,
} from "../core/mail";
import * as settings from "../core/repo/settings";
import { expect, suite, test, throwsKind } from "./harness";
import { fakeSecrets, tempDb } from "./support";

function config(over: Partial<SmtpConfig> = {}): SmtpConfig {
  return {
    host: "smtp.example.com",
    port: 587,
    username: "office@sunrise.example",
    password: "hunter2",
    fromName: "Sunrise Insurance Services",
    fromEmail: "office@sunrise.example",
    encryption: "starttls",
    ...over,
  };
}

suite("the mail server settings", () => {
  test("come from the book, except the password", () => {
    const db = tempDb("smtp-load");
    db.with((conn) => {
      settings.putMany(conn, {
        smtp_host: "  smtp.example.com  ",
        smtp_port: "465",
        smtp_username: " office@sunrise.example ",
        smtp_from_name: " Sunrise Insurance Services ",
        smtp_from_email: " office@sunrise.example ",
        smtp_encryption: "ssl",
      });
    });

    const secrets = fakeSecrets();
    secrets.save("smtp-password", "hunter2");

    expect.deepEqual(
      db.with((conn) => load(conn, secrets)),
      config({ port: 465, encryption: "tls" }),
      "a password typed into an export or a backup is a password in the wrong place",
    );

    // Nothing is stored, so nothing is recalled, and the screen says the password
    // is not set rather than pretending it is.
    expect.equal(db.with((conn) => load(conn, fakeSecrets())).password, "");
    db.close();
  });

  test("keep the port inside a port's range", () => {
    const db = tempDb("smtp-port");
    const secrets = fakeSecrets();

    const port = (raw: string) =>
      db.with((conn) => {
        settings.put(conn, "smtp_port", raw);
        return load(conn, secrets).port;
      });

    expect.equal(port("2525"), 2_525);
    expect.equal(port("0"), 1);
    expect.equal(port("99999"), 65_535);
    expect.equal(port("not a number"), 587, "an unreadable setting falls back to the default");
    db.close();
  });

  test("are not usable until there is a server and an address to send from", () => {
    expect.ok(isUsable(config()));
    expect.ok(!isUsable(config({ host: "" })));
    expect.ok(!isUsable(config({ fromEmail: "" })));
    expect.ok(
      isUsable(config({ username: "", password: "" })),
      "a server that needs no login is a server that can still be used",
    );
  });
});

suite("how the connection is protected", () => {
  test("is what the setting says, whatever it was called", () => {
    for (const raw of ["tls", "TLS", " ssl ", "implicit"]) {
      expect.equal(parseEncryption(raw), "tls", raw);
    }
    for (const raw of ["none", "plain", "", "   "]) {
      expect.equal(parseEncryption(raw), "none", raw);
    }
    for (const raw of ["starttls", "STARTTLS", "anything else"]) {
      expect.equal(parseEncryption(raw), "starttls", raw);
    }
  });

  test("wraps the socket for implicit TLS and upgrades it for STARTTLS", () => {
    const wrapped = transportOptions(config({ port: 465, encryption: "tls" }));
    expect.equal(wrapped.secure, true);
    expect.equal(wrapped.requireTLS, false);

    const upgraded = transportOptions(config({ encryption: "starttls" }));
    expect.equal(upgraded.secure, false);
    expect.equal(
      upgraded.requireTLS,
      true,
      "a server that cannot upgrade is a failure, not a plain-text send nobody was told about",
    );
    expect.equal(upgraded.ignoreTLS, false);

    const plain = transportOptions(config({ encryption: "none" }));
    expect.equal(plain.secure, false);
    expect.equal(plain.ignoreTLS, true);
  });

  test("carries lettre's own pool and timeouts rather than nodemailer's", () => {
    const options = transportOptions(config());
    expect.equal(options.pool, true);
    expect.equal(options.maxConnections, 10);
    expect.deepEqual(
      [options.connectionTimeout, options.greetingTimeout, options.socketTimeout],
      [60_000, 60_000, 60_000],
      "one timeout in lettre, three in nodemailer, the same minute either way",
    );
  });

  test("is offered no login when the settings name no user", () => {
    expect.equal(transportOptions(config({ username: "" })).auth, undefined);
    expect.deepEqual(transportOptions(config()).auth, {
      user: "office@sunrise.example",
      pass: "hunter2",
    });
  });
});

suite("opening a connection", () => {
  test("refuses before the server has been named", async () => {
    const error = await throwsKind("mail", () => Mailer.connect(config({ host: "" })));
    expect.equal(error.message, "Mail error: No mail server is set up yet.");
  });

  test("refuses an address it could not have sent from", async () => {
    const error = await throwsKind("mail", () =>
      Mailer.connect(config({ fromEmail: "sunrise at example" })),
    );
    expect.equal(error.message, "Mail error: `sunrise at example` is not a valid address");
  });
});

suite("a message", () => {
  test("is refused before the network when its recipient is not an address", async () => {
    const mailer = Mailer.connect(config());
    try {
      const error = await throwsKind("mail", () =>
        mailer.send({
          toName: "Ananya Sharma",
          toEmail: "ananya@example",
          subject: "Your policy expires soon",
          html: "<p>Hello</p>",
        }),
      );
      expect.equal(error.message, "Mail error: `ananya@example` is not a valid address");
    } finally {
      mailer.close();
    }
  });
});
