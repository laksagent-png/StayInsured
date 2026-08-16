/**
 * The ladder of reminder rules, ported from the Rust tests of the same names:
 * `the_ladder_reads_from_furthest_ahead_to_nearest`,
 * `a_rule_the_form_does_not_place_joins_the_ladder_at_the_end`,
 * `a_rule_that_writes_to_a_client_needs_something_to_say` and
 * `deleting_a_rule_keeps_the_record_of_what_it_sent`.
 *
 * The order the rules come back in is the order the settings screen prints them,
 * and the order the sweep will walk them, so it is part of the contract rather
 * than a detail of the query. The refusals are the other half: a rule that writes
 * to a client with no message would send an empty email, which is worse than the
 * rule never existing.
 */

import * as notifications from "../core/repo/notifications";
import * as rules from "../core/repo/rules";
import * as templates from "../core/repo/templates";
import { todayIso } from "../core/util";
import { expect, suite, test, throwsKind } from "./harness";
import { bookExpiringIn, sampleRule, sampleTemplate, scalar, tempDb } from "./support";

suite("the ladder of rules", () => {
  test("reads from furthest ahead of expiry to nearest", () => {
    const db = tempDb("ladder");
    db.with((conn) => {
      expect.deepEqual(
        rules.list(conn).map((rule) => rule.offsetDays),
        [60, 30, 15, 7, 1, -7],
        "the settings screen shows the ladder in the order it fires",
      );
      expect.deepEqual(
        rules.active(conn).map((rule) => rule.offsetDays),
        [60, 30, 15, 7, 1],
        "the chase after expiry is seeded but left off until it is wanted",
      );
    });
    db.close();
  });

  test("takes a rule the form does not place at the end", () => {
    const db = tempDb("ladder-append");
    db.with((conn) => {
      const template = templates.create(conn, sampleTemplate("Renewal due"));
      const last = Math.max(...rules.list(conn).map((rule) => rule.sortOrder));

      // The form leaves the placement out, so the core decides it.
      const id = rules.create(conn, sampleRule("45 days before expiry", template));

      const placed = rules.list(conn).find((rule) => rule.id === id);
      expect.ok(placed, "the new rule is on the ladder");
      expect.ok(
        placed.sortOrder > last,
        `a new rule goes below the ones already there, not above them: ` +
          `${placed.sortOrder} is not past ${last}`,
      );

      // Editing it without naming a place leaves it where it was.
      rules.update(conn, id, sampleRule("45 days before expiry, renamed", template));
      const after = rules.list(conn).find((rule) => rule.id === id);
      expect.ok(after, "the rule survives being renamed");
      expect.equal(after.sortOrder, placed.sortOrder, "an edit does not reshuffle the ladder");
    });
    db.close();
  });
});

suite("what a rule has to say", () => {
  test("refuses a rule that writes to a client with nothing to say", async () => {
    const db = tempDb("rule-validation");
    await db.with(async (conn) => {
      const template = templates.create(conn, sampleTemplate("Renewal due"));

      await throwsKind(
        "validation",
        () => rules.create(conn, { ...sampleRule("Nothing to say", template), templateId: null }),
        "a rule that writes to a client without a message would send an empty email",
      );

      // The digest to the agent is assembled rather than templated, so it is
      // allowed to go without one.
      rules.create(conn, {
        ...sampleRule("Provider digest", template),
        audience: "provider",
        templateId: null,
      });

      await throwsKind("not_found", () =>
        rules.create(conn, { ...sampleRule("Points nowhere", template), templateId: 9_999 }),
      );

      await throwsKind("validation", () =>
        rules.create(conn, { ...sampleRule("Too far out", template), offsetDays: 400 }),
      );

      await throwsKind("validation", () =>
        rules.create(conn, { ...sampleRule("Odd channel", template), channel: "pigeon" }),
      );

      await throwsKind("validation", () =>
        rules.create(conn, { ...sampleRule("Odd audience", template), audience: "pigeon" }),
      );

      await throwsKind("validation", () =>
        rules.create(conn, { ...sampleRule("Odd category", template), category: "spaceship" }),
      );

      rules.create(conn, sampleRule("45 days before expiry", template));
      await throwsKind(
        "conflict",
        () => rules.create(conn, sampleRule("45 days before expiry", template)),
        "two rules with one name would be indistinguishable in the list",
      );
    });
    db.close();
  });
});

suite("removing a rule", () => {
  test("keeps the record of what it already sent", async () => {
    const db = tempDb("rule-history");
    const { clientId, policyId } = bookExpiringIn(db, 30, "ananya@example.com");

    await db.with(async (conn) => {
      const template = templates.activeForTrigger(conn, "expiry_reminder");
      expect.ok(template, "the seed leaves an expiry reminder switched on");
      const rule = rules.create(conn, sampleRule("45 days before expiry", template.id));

      notifications.queue(conn, {
        ruleId: rule,
        policyId,
        clientId,
        policyPeriod: "2027-03-31",
        audience: "client",
        channel: "email",
        toAddress: "ananya@example.com",
        subject: "Your policy expires soon",
        body: "<p>Hello</p>",
        scheduledFor: todayIso(),
      });

      rules.remove(conn, rule);

      // What was sent to a client is a record of the agency's dealings with them,
      // so changing the ladder must not erase it.
      expect.equal(scalar<number>(conn, "SELECT COUNT(*) FROM notification_log"), 1);
      expect.equal(
        scalar<number | null>(conn, "SELECT rule_id FROM notification_log"),
        null,
        "it simply stops pointing at a rule that no longer exists",
      );

      await throwsKind("not_found", () => rules.remove(conn, rule));
    });
    db.close();
  });
});
