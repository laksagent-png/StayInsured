/**
 * The outbox, ported from the Rust tests of the same names:
 * `a_reminder_is_recorded_once_per_policy_year`,
 * `the_outbox_only_moves_the_way_the_screen_allows`,
 * `only_what_is_due_leaves_the_outbox`,
 * `renewing_clears_only_the_reminders_still_waiting`,
 * `renewing_cancels_the_reminder_still_waiting_to_go_out` and the outbox half of
 * `a_search_for_a_percent_sign_looks_for_a_percent_sign`.
 *
 * Every one of these is about not sending something twice, or not sending it at
 * all. The unique key on (rule, policy, policy year) is the whole of the "once"
 * guarantee, and it is the kind of rule that looks fine until an agency's clients
 * receive the same reminder four times in a morning.
 */

import type { Conn } from "../core/db";
import * as notifications from "../core/repo/notifications";
import * as policies from "../core/repo/policies";
import * as rules from "../core/repo/rules";
import { todayIso } from "../core/util";
import { expect, suite, test, throwsKind } from "./harness";
import { bookExpiringIn, daysFromToday, scalar, tempDb } from "./support";

/** `queue_reminder` in the Rust tests: one queued row, with the parts that vary. */
function queueReminder(
  conn: Conn,
  ruleId: number,
  clientId: number,
  policyId: number,
  period: string,
  scheduledFor: string,
): number | null {
  return notifications.queue(conn, {
    ruleId,
    policyId,
    clientId,
    policyPeriod: period,
    audience: "client",
    channel: "email",
    toAddress: "ananya@example.com",
    subject: "Your policy expires soon",
    body: "<p>Hello</p>",
    scheduledFor,
  });
}

suite("recording a reminder", () => {
  test("happens once per policy year, however often the sweep runs", () => {
    const db = tempDb("outbox-once");
    const { clientId, policyId } = bookExpiringIn(db, 30, "ananya@example.com");

    db.with((conn) => {
      const rule = rules.active(conn)[0]!.id;
      const today = todayIso();

      const first = queueReminder(conn, rule, clientId, policyId, "2027-03-31", today);
      expect.ok(first !== null, "the first write lands");
      expect.ok(notifications.alreadyLogged(conn, rule, policyId, "2027-03-31"));

      expect.equal(
        queueReminder(conn, rule, clientId, policyId, "2027-03-31", today),
        null,
        "one rule writes to one policy year once, however often the sweep runs",
      );
      expect.equal(notifications.countByStatus(conn, "queued"), 1);

      // Next year is a different period, so the ladder starts again.
      expect.ok(queueReminder(conn, rule, clientId, policyId, "2028-03-31", today) !== null);
      expect.equal(notifications.countByStatus(conn, "queued"), 2);

      // The record is what holds the reminder back, so cancelling one does not
      // free the slot for a second attempt at the same year.
      notifications.cancel(conn, first);
      expect.equal(queueReminder(conn, rule, clientId, policyId, "2027-03-31", today), null);
    });
    db.close();
  });
});

suite("the outbox", () => {
  test("only moves the way the screen allows", async () => {
    const db = tempDb("outbox-moves");
    const { clientId, policyId } = bookExpiringIn(db, 30, "ananya@example.com");

    await db.with(async (conn) => {
      const ladder = rules.active(conn);
      const today = todayIso();
      const id = queueReminder(conn, ladder[0]!.id, clientId, policyId, "2027-03-31", today);
      expect.ok(id !== null, "queued");

      await throwsKind(
        "conflict",
        () => notifications.requeue(conn, id),
        "something already waiting cannot be sent again",
      );

      notifications.cancel(conn, id);
      await throwsKind("conflict", () => notifications.cancel(conn, id));

      notifications.requeue(conn, id);
      expect.equal(notifications.countByStatus(conn, "queued"), 1);

      notifications.markSent(conn, id);
      await throwsKind(
        "conflict",
        () => notifications.requeue(conn, id),
        "what has gone to a client is not offered again by mistake",
      );
      await throwsKind("conflict", () => notifications.cancel(conn, id));

      // A skip is a fact about the book that may be corrected, and a failure is
      // worth another try, so both can go back in the queue.
      const second = queueReminder(conn, ladder[1]!.id, clientId, policyId, "2027-03-31", today);
      expect.ok(second !== null, "queued");
      notifications.markSkipped(conn, second, "No email address");
      notifications.requeue(conn, second);

      notifications.markAttemptFailed(conn, second, "Server refused", 1);
      expect.equal(notifications.countByStatus(conn, "failed"), 1);
      notifications.requeue(conn, second);
      expect.deepEqual(
        [
          scalar<number>(conn, "SELECT attempts FROM notification_log WHERE id = ?", second),
          scalar<string | null>(conn, "SELECT last_error FROM notification_log WHERE id = ?", second),
        ],
        [0, null],
        "trying again starts the attempt count over",
      );
    });
    db.close();
  });

  test("hands out only what is due, oldest first", () => {
    const db = tempDb("outbox-due");
    const { clientId, policyId } = bookExpiringIn(db, 30, "ananya@example.com");

    db.with((conn) => {
      const ladder = rules.active(conn);
      const today = todayIso();
      const at = (index: number, when: string) => {
        const id = queueReminder(conn, ladder[index]!.id, clientId, policyId, "2027-03-31", when);
        expect.ok(id !== null, "queued");
        return id;
      };

      const waiting = at(0, daysFromToday(1));
      const now = at(1, today);
      const overdue = at(2, daysFromToday(-1));

      const ids = notifications.due(conn, today, 10).map((payload) => payload.id);
      expect.deepEqual(
        ids,
        [overdue, now],
        "a backlog drains oldest first, and nothing goes before its date",
      );
      expect.ok(!ids.includes(waiting));

      expect.equal(
        notifications.due(conn, today, 1).length,
        1,
        "the daily cap is a limit on what is taken out",
      );

      notifications.cancel(conn, overdue);
      expect.deepEqual(
        notifications.due(conn, today, 10).map((payload) => payload.id),
        [now],
        "only what is still queued is due",
      );

      const payload = notifications.due(conn, today, 10)[0]!;
      expect.equal(payload.clientName, "Ananya Sharma");
      expect.equal(payload.toAddress, "ananya@example.com");
      expect.equal(payload.subject, "Your policy expires soon");
    });
    db.close();
  });
});

suite("a renewal", () => {
  test("clears only the reminders still waiting", () => {
    const db = tempDb("outbox-clear");
    const { clientId, policyId } = bookExpiringIn(db, 30, "ananya@example.com");

    db.with((conn) => {
      const ladder = rules.active(conn);
      const today = todayIso();
      const waiting = queueReminder(conn, ladder[0]!.id, clientId, policyId, "2027-03-31", today);
      const gone = queueReminder(conn, ladder[1]!.id, clientId, policyId, "2027-03-31", today);
      expect.ok(gone !== null, "queued");
      notifications.markSent(conn, gone);

      const day = scalar<string>(conn, "SELECT date(sent_at) FROM notification_log WHERE id = ?", gone);
      expect.equal(
        notifications.sentOn(conn, day),
        1,
        "the daily count reads the day a message actually went",
      );

      expect.equal(notifications.cancelForPolicy(conn, policyId), 1);
      expect.equal(notifications.countByStatus(conn, "cancelled"), 1);
      expect.equal(
        notifications.countByStatus(conn, "sent"),
        1,
        "a message already with the client cannot be recalled",
      );

      expect.equal(
        scalar<string | null>(conn, "SELECT last_error FROM notification_log WHERE id = ?", waiting),
        "The policy was renewed",
      );

      // The outbox filter drops a status the app does not know rather than
      // matching on it.
      const sentOnly = notifications.list(conn, { statuses: ["sent", "teapot"] });
      expect.equal(sentOnly.total, 1);
      expect.equal(sentOnly.rows[0]!.id, gone);
    });
    db.close();
  });

  test("takes the waiting reminders with it when a policy is renewed", () => {
    const db = tempDb("outbox-renewal");
    const { clientId, policyId } = bookExpiringIn(db, 30, "ananya@example.com");

    db.withTx((conn) => {
      const rule = rules.active(conn)[0]!.id;
      queueReminder(conn, rule, clientId, policyId, "2027-03-31", todayIso());
      // The insurer issues a fresh number for the new year.
      policies.renew(conn, { policyId, policyNumber: "SH/2027/884213" });

      expect.equal(
        scalar<string>(conn, "SELECT status FROM notification_log WHERE policy_id = ?", policyId),
        "cancelled",
        "a renewed client should not be chased about expiry",
      );
    });
    db.close();
  });
});

suite("reading the outbox", () => {
  test("puts the newest first, and sorts by the columns the screen offers", () => {
    const db = tempDb("outbox-list");
    const { clientId, policyId } = bookExpiringIn(db, 30, "ananya@example.com");

    db.with((conn) => {
      const ladder = rules.active(conn);
      const days = [1, 0, -1].map((offset) => daysFromToday(offset));
      days.forEach((when, index) => {
        queueReminder(conn, ladder[index]!.id, clientId, policyId, "2027-03-31", when);
      });

      expect.deepEqual(
        notifications.list(conn, {}).rows.map((row) => row.scheduledFor),
        days,
        "the outbox is read to find out what just happened, so it defaults to newest first",
      );

      // The sort key arrives from the table header, and one of them names a
      // column the query only invents in its SELECT.
      const byName = notifications.list(conn, { sort: "clientName", descending: false });
      expect.equal(byName.total, 3);
      expect.equal(byName.rows[0]!.clientName, "Ananya Sharma");

      const paged = notifications.list(conn, { pageSize: 2, page: 2 });
      expect.equal(paged.total, 3, "the count ignores the page");
      expect.equal(paged.rows.length, 1);
      expect.equal(paged.pageSize, 2);
    });
    db.close();
  });
});

suite("searching the outbox", () => {
  test("looks for a percent sign rather than obeying one", () => {
    const db = tempDb("outbox-search");
    const { clientId, policyId } = bookExpiringIn(db, 30, "ananya@example.com");

    db.with((conn) => {
      const ladder = rules.active(conn);
      const today = todayIso();
      ["Renewal 50% complete", "Renewal 5000 complete"].forEach((subject, index) => {
        notifications.queue(conn, {
          ruleId: ladder[index]!.id,
          policyId,
          clientId,
          policyPeriod: "2027-03-31",
          audience: "client",
          channel: "email",
          toAddress: "ananya@example.com",
          subject,
          body: "<p>Hello</p>",
          scheduledFor: today,
        });
      });

      const found = notifications.list(conn, { search: "50%" });
      expect.equal(found.total, 1, "the percent sign is text, not a wildcard");
      expect.equal(found.rows[0]!.subject, "Renewal 50% complete");

      const byClient = notifications.list(conn, { search: "Ananya" });
      expect.equal(byClient.total, 2, "a search reaches the client's name as well as the subject");
    });
    db.close();
  });
});
