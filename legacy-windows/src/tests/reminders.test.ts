/**
 * The sweep, ported from the Rust tests of the same names:
 * `a_rule_fires_on_its_day_and_not_before`,
 * `a_reminder_is_sent_once_however_often_the_sweep_runs`,
 * `a_dry_run_writes_nothing_and_sends_nothing`,
 * `opting_out_and_missing_addresses_are_recorded_not_retried`,
 * `a_failed_send_stays_queued_until_it_gives_up` and
 * `the_daily_cap_holds_the_rest_back_for_tomorrow`, with the day's digest and the
 * five commands the reminder screens call after them. When the tick runs the sweep
 * is in `shell.test.ts`, beside the rest of what the shell decides.
 *
 * Every one of these is about a message reaching a client exactly once. An agency
 * that sends the same reminder four times in a morning has done more damage than
 * one that sends none, so the outbox is written before anything goes out and the
 * assertions below are mostly about what is *not* in it.
 */

import { dispatch } from "../core/commands";
import { AppError } from "../core/errors";
import type { Outgoing } from "../core/mail";
import {
  alerts,
  liveOptions,
  overview,
  plan,
  sweep,
  type Alerter,
  type Sender,
} from "../core/reminders";
import * as clients from "../core/repo/clients";
import * as insurers from "../core/repo/insurers";
import * as policies from "../core/repo/policies";
import * as settings from "../core/repo/settings";
import type { PlannedReminder, ReminderOverview, ReminderRun } from "../core/types";
import { formatDate, todayIso } from "../core/util";
import { expect, suite, test, throwsKind } from "./harness";
import {
  bookExpiringIn,
  daysFromToday,
  fakeSecrets,
  sampleClient,
  samplePolicy,
  scalar,
  tempDb,
  tempEnv,
  unlockedSession,
} from "./support";

/**
 * Stands in for the mail server. Records what it was asked to send, and can be
 * told to fail so the retry path is exercised without a network. `FakeMail` in the
 * Rust tests, and the reason `sweep` takes a `Sender` rather than a `Mailer`.
 */
class FakeMail implements Sender {
  private readonly delivered: [string, string][] = [];

  constructor(private readonly failWith: string | null = null) {}

  static failing(reason: string): FakeMail {
    return new FakeMail(reason);
  }

  deliver(message: Outgoing): Promise<void> {
    if (this.failWith !== null) return Promise.reject(AppError.mail(this.failWith));
    this.delivered.push([message.toEmail, message.subject]);
    return Promise.resolve();
  }

  count(): number {
    return this.delivered.length;
  }

  recipients(): string[] {
    return this.delivered.map(([to]) => to);
  }
}

/** `NoAlerts` in the Rust tests: there is no desktop here to alert. */
const noAlerts: Alerter = { alert: () => undefined };

suite("a rule", () => {
  test("fires on its day and not before", () => {
    const db = tempDb("rule-timing");
    bookExpiringIn(db, 30, "ananya@example.com");

    db.with((conn) => {
      const today = todayIso();
      // The ladder has a rule at 30 days and one at 60.
      const due = plan(conn, today);
      expect.equal(due.length, 1, "only the 30-day rule matches today");
      expect.equal(due[0]!.daysToExpiry, 30);
      expect.equal(due[0]!.blockedReason, null);

      expect.deepEqual(plan(conn, daysFromToday(1)), [], "nothing is due the day after");
    });
    db.close();
  });
});

suite("a reminder", () => {
  test("is sent once, however often the sweep runs", async () => {
    const db = tempDb("sweep-once");
    bookExpiringIn(db, 30, "ananya@example.com");
    const mail = new FakeMail();

    const first = await db.with((conn) => sweep(conn, mail, noAlerts, liveOptions()));
    expect.equal(first.queued, 1);
    expect.equal(first.sent, 1);
    expect.deepEqual(mail.recipients(), ["ananya@example.com"]);

    // Three more sweeps on the same day, as if the app restarted repeatedly.
    for (let i = 0; i < 3; i += 1) {
      const again = await db.with((conn) => sweep(conn, mail, noAlerts, liveOptions()));
      expect.equal(again.queued, 0);
      expect.equal(again.sent, 0);
    }
    expect.equal(mail.count(), 1, "the client is written to exactly once");
    db.close();
  });
});

suite("a dry run", () => {
  test("writes nothing and sends nothing", async () => {
    const db = tempDb("dry-run");
    bookExpiringIn(db, 30, "ananya@example.com");
    const mail = new FakeMail();

    const run = await db.with((conn) =>
      sweep(conn, mail, noAlerts, { today: todayIso(), dryRun: true }),
    );

    expect.ok(run.dryRun);
    expect.equal(run.queued, 1, "it still reports what would go out");
    expect.equal(mail.count(), 0);

    db.with((conn) => {
      expect.equal(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM notification_log"),
        0,
        "a dry run leaves the outbox empty",
      );
    });
    db.close();
  });
});

suite("opting out and missing addresses", () => {
  test("are recorded, not retried", async () => {
    const db = tempDb("blocked");
    const { clientId } = bookExpiringIn(db, 30, null);
    const mail = new FakeMail();

    const run = await db.with((conn) => sweep(conn, mail, noAlerts, liveOptions()));
    expect.equal(run.skipped, 1);
    expect.equal(mail.count(), 0);

    db.with((conn) => {
      expect.equal(
        scalar<string>(conn, "SELECT status FROM notification_log WHERE client_id = ?", clientId),
        "skipped",
      );
      const reason = scalar<string | null>(
        conn,
        "SELECT last_error FROM notification_log WHERE client_id = ?",
        clientId,
      );
      expect.ok(reason?.includes("No email address"), `unexpected reason: ${reason}`);
    });

    // The skip is remembered, so the same client is not raised again tomorrow.
    const second = await db.with((conn) => sweep(conn, mail, noAlerts, liveOptions()));
    expect.equal(second.skipped, 0);
    db.close();
  });

  test("say which of the two it was, before anything is written", () => {
    const db = tempDb("blocked-reasons");
    const { clientId } = bookExpiringIn(db, 30, "ananya@example.com");

    // Written with SQL rather than through `clients.update`, because one of the
    // states under test is an address the form would refuse to save. The sweep has
    // to cope with it regardless: books imported from a spreadsheet hold text that
    // no screen would have accepted.
    db.with((conn) => {
      expect.equal(plan(conn, todayIso())[0]!.blockedReason, null);

      conn.prepare("UPDATE clients SET reminders_opted_out = 1 WHERE id = ?").run(clientId);
      expect.equal(
        plan(conn, todayIso())[0]!.blockedReason,
        "The client has opted out of reminders",
        "a client who asked not to be written to is listed, and left alone",
      );

      conn
        .prepare(
          "UPDATE clients SET reminders_opted_out = 0, email = 'ananya at example' WHERE id = ?",
        )
        .run(clientId);
      expect.equal(
        plan(conn, todayIso())[0]!.blockedReason,
        "The email address does not look valid",
        "an address with no domain is a typo, not something to keep retrying",
      );
    });
    db.close();
  });
});

suite("a failed send", () => {
  test("stays queued until it gives up", async () => {
    const db = tempDb("retry");
    bookExpiringIn(db, 30, "ananya@example.com");
    const broken = FakeMail.failing("The server refused the message");

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await db.with((conn) => sweep(conn, broken, noAlerts, liveOptions()));

      db.with((conn) => {
        expect.equal(
          scalar<number>(conn, "SELECT attempts FROM notification_log LIMIT 1"),
          attempt,
        );
        expect.equal(
          scalar<string>(conn, "SELECT status FROM notification_log LIMIT 1"),
          attempt < 3 ? "queued" : "failed",
          attempt < 3 ? "it waits for the next sweep" : "after three tries it stops",
        );
      });
    }
    db.close();
  });
});

suite("the daily cap", () => {
  test("holds the rest back for tomorrow", async () => {
    const db = tempDb("cap");
    const mail = new FakeMail();

    db.withTx((conn) => {
      settings.put(conn, "daily_send_cap", "2");
      settings.put(conn, "digest_enabled", "false");
      const insurerId = insurers.findOrCreate(conn, "Star Health and Allied Insurance");
      const expiry = daysFromToday(30);
      for (let i = 0; i < 5; i += 1) {
        const input = sampleClient(`Client ${i}`);
        input.email = `client${i}@example.com`;
        const clientId = clients.create(conn, input);
        policies.create(conn, samplePolicy(clientId, insurerId, `SH/2026/${i}`, expiry));
      }
    });

    const run = await db.with((conn) => sweep(conn, mail, noAlerts, liveOptions()));

    expect.equal(run.queued, 5, "all five are written to the outbox");
    expect.equal(run.sent, 2, "only two are sent today");
    expect.equal(run.heldByCap, 3);
    expect.equal(mail.count(), 2);

    db.with((conn) => {
      expect.equal(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM notification_log WHERE status = 'queued'"),
        3,
        "the rest keep their place in the queue",
      );
      expect.equal(
        overview(conn, fakeSecrets()).queued,
        3,
        "and the screen says so without being told twice",
      );
    });
    db.close();
  });
});

suite("the day's digest", () => {
  test("reaches the agency once, whatever the sweep does afterwards", async () => {
    const db = tempDb("digest");
    bookExpiringIn(db, 30, "ananya@example.com");
    db.withTx((conn) => {
      settings.put(conn, "digest_enabled", "true");
      settings.put(conn, "provider_email", "office@sunrise.example");
    });
    const mail = new FakeMail();

    const first = await db.with((conn) => sweep(conn, mail, noAlerts, liveOptions()));
    expect.ok(first.digestSent);
    expect.deepEqual(
      mail.recipients(),
      ["ananya@example.com", "office@sunrise.example"],
      "the client's reminder goes out before the summary of it",
    );

    const second = await db.with((conn) => sweep(conn, mail, noAlerts, liveOptions()));
    expect.ok(!second.digestSent, "one summary a day, not one a sweep");
    expect.equal(mail.count(), 2);

    db.with((conn) => {
      expect.equal(
        scalar<number>(
          conn,
          "SELECT COUNT(*) AS n FROM notification_log WHERE audience = 'provider'",
        ),
        1,
      );
    });
    db.close();
  });
});

suite("a rule set to alert as well as write", () => {
  test("raises the notification on this computer", async () => {
    const db = tempDb("desktop-alert");
    const env = tempEnv("desktop-alert");
    // The seeded ladder sends the 7-day notice by email and desktop alert both.
    const expiry = formatDate(daysFromToday(7), "dd/MM/yyyy");
    bookExpiringIn(db, 7, "ananya@example.com");

    const run = await db.with((conn) => sweep(conn, new FakeMail(), alerts(env), liveOptions()));

    expect.equal(run.desktopAlerts, 1);
    expect.deepEqual(
      env.alerted,
      [["Ananya Sharma expires soon", `SH/2026/884213 · ${expiry} · 7 days`]],
      "the banner names the client, the policy and how long is left",
    );
    db.close();
  });
});

suite("the commands the reminder screens call", () => {
  test("need the book open, and take the screen's practice-mode switch", async () => {
    const { session } = await unlockedSession("reminder-commands");
    bookExpiringIn(session.db(), 30, "ananya@example.com");

    const summary = (await dispatch(session, "reminder_overview", {})) as ReminderOverview;
    expect.equal(summary.dueToday, 1);
    expect.ok(!summary.smtpConfigured, "a fresh book has no mail server yet");

    const planned = (await dispatch(session, "plan_reminders", {})) as PlannedReminder[];
    expect.equal(planned.length, 1);

    // Left unanswered, the run follows the stored setting, which a new book seeds
    // to practice mode so nothing reaches a client before an operator says so.
    const stored = (await dispatch(session, "run_reminders", {})) as ReminderRun;
    expect.ok(stored.dryRun);
    expect.equal(stored.queued, 1);

    // Asked to send with no mail server, it says what is missing rather than
    // filling the outbox with failures.
    await throwsKind("mail", () => dispatch(session, "run_reminders", { dryRun: false }));
    await throwsKind("validation", () => dispatch(session, "send_test_email", { to: "ananya at" }));
    await throwsKind("mail", () =>
      dispatch(session, "send_test_email", { to: "ananya@example.com" }),
    );

    session.lock();
    for (const command of ["reminder_overview", "plan_reminders", "run_reminders"]) {
      await throwsKind("locked", () => dispatch(session, command, {}));
    }
    await throwsKind(
      "locked",
      () => dispatch(session, "set_smtp_password", { password: "hunter2" }),
      "the keychain is not touched until the app is open",
    );
  });

  test("keep the SMTP password out of the book", async () => {
    const { session, env } = await unlockedSession("smtp-password");
    const passwordSet = () =>
      session.db().with((conn) => overview(conn, env.secrets).smtpPasswordSet);

    await dispatch(session, "set_smtp_password", { password: "hunter2" });
    expect.equal(env.secrets.store.get("smtp-password"), "hunter2");
    expect.ok(passwordSet(), "the screen shows a password is set without being able to read it");

    // The Settings screen clears it by sending nothing rather than an empty string.
    await dispatch(session, "set_smtp_password", {});
    expect.equal(env.secrets.store.get("smtp-password"), undefined);
    expect.ok(!passwordSet());
  });
});