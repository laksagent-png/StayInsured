/**
 * The renewal chain and the status sweep, ported from the Rust tests of the same
 * names: `renewal_builds_a_chain_and_preserves_history`,
 * `statuses_follow_the_calendar`, `a_cancelled_policy_is_left_alone_by_the_sweep`,
 * `renewing_a_cancelled_year_leaves_it_cancelled`,
 * `an_expiry_moved_forward_brings_a_policy_back`,
 * `editing_a_policy_leaves_its_place_in_the_chain_alone`,
 * `a_policy_renumbered_or_filled_in_is_still_the_one_the_lists_find`,
 * `a_chain_keeps_exactly_one_open_year`, `deleting_a_year_leaves_the_earlier_ones_standing`,
 * `duplicate_policy_number_for_same_insurer_is_rejected`,
 * `two_insurers_may_each_use_the_same_policy_number`,
 * `only_the_statuses_the_app_knows_are_accepted` and
 * `members_attach_only_to_their_own_client`.
 *
 * This is the file worth having. Everything else in the port either works or
 * throws; these rules can be subtly wrong and stay quiet for a year, until a
 * renewal that should have been on the desk was not, and the client's cover
 * lapsed. The Rust suite is the specification and these are the same cases.
 */

import * as clients from "../core/repo/clients";
import * as dashboard from "../core/repo/dashboard";
import * as insurers from "../core/repo/insurers";
import * as relations from "../core/repo/relations";
import * as policies from "../core/repo/policies";
import { expect, suite, test, throwsKind } from "./harness";
import { daysFromToday, sampleClient, samplePolicy, tempDb } from "./support";

suite("the health details a proposal is written on", () => {
  // Ported from `a_health_policy_keeps_the_detail_its_proposal_was_written_on`.
  test("are stored as chosen, handed back as a list, and carried into next year", () => {
    const db = tempDb("health-details");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Rohit Sharma"));
      const insurer = insurers.findOrCreate(conn, "Star Health");

      const id = policies.create(conn, {
        ...samplePolicy(client, insurer, "HS/2026/001", "2029-03-31"),
        variant: "Gold",
        // Clicked in this order, which is not the insurer's.
        riders: ["future_ready", "safeguard"],
        planType: "family_floater",
        term: 3,
        policyType: "portability",
        broker: "Deshmukh Insurance Services",
        inbuiltRider: "Road ambulance cover",
      });

      const policy = policies.get(conn, id);
      expect.deepEqual(
        policy.riders,
        ["safeguard", "future_ready"],
        "riders come back in the insurer's order, not the order of clicking",
      );
      expect.equal(policy.variant, "Gold");
      expect.equal(policy.term, 3);

      const next = policies.renew(conn, { policyId: id, policyNumber: "HS/2029/002" });
      const renewed = policies.get(conn, next);

      expect.equal(
        renewed.expiryDate,
        "2032-03-31",
        "three years were bought, so three years are renewed",
      );
      expect.deepEqual(renewed.riders, policy.riders, "the riders come along");
      expect.equal(renewed.policyType, "renewal", "a ported year renews into a renewal");
    });
    db.close();
  });

  // No Rust counterpart, and that is the point: `dashboard.rs` reads through the
  // same `POLICY_COLUMNS` the lists do, so it cannot fall behind them. Here the
  // dashboard has its own query, and a column added to one and not the other
  // would hand this screen a policy with the health answers missing.
  test("reach the dashboard the way they reach every other list", () => {
    const db = tempDb("health-dashboard");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Meera Iyer"));
      const insurer = insurers.findOrCreate(conn, "Star Health");
      policies.create(conn, {
        ...samplePolicy(client, insurer, "HS/2026/020", daysFromToday(20)),
        variant: "Platinum",
        riders: ["safeguard"],
        planType: "individual",
      });

      const [upcoming] = dashboard.load(conn).upcoming;
      expect.equal(upcoming?.variant, "Platinum");
      expect.deepEqual(upcoming?.riders, ["safeguard"]);
      expect.equal(upcoming?.planType, "individual");
    });
    db.close();
  });

  // Ported from `the_health_details_are_held_to_the_words_the_app_knows`.
  test("are held to the words the app knows, but not required to be there", async () => {
    const db = tempDb("health-words");
    await db.with(async (conn) => {
      const client = clients.create(conn, sampleClient("Rohit Sharma"));
      const insurer = insurers.findOrCreate(conn, "Star Health");

      const spoilers: [string, Partial<Parameters<typeof policies.create>[1]>][] = [
        ["HS/2026/010", { planType: "floater" }],
        ["HS/2026/011", { policyType: "port" }],
        ["HS/2026/012", { riders: ["gold_cover"] }],
        ["HS/2026/013", { term: 9 }],
      ];
      for (const [number, spoiled] of spoilers) {
        await throwsKind(
          "validation",
          () =>
            policies.create(conn, {
              ...samplePolicy(client, insurer, number, "2027-03-31"),
              ...spoiled,
            }),
          `${number} should have been refused`,
        );
      }

      // A book that predates the questions still goes in: the screen asks for
      // these, the core does not.
      const plain = policies.create(
        conn,
        samplePolicy(client, insurer, "HS/2026/014", "2027-03-31"),
      );
      expect.deepEqual(policies.get(conn, plain).riders, []);
      expect.equal(policies.get(conn, plain).planType, null);
    });
    db.close();
  });
});

suite("renewal", () => {
  test("builds a chain and preserves history", () => {
    const db = tempDb("renew");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Rohit Sharma"));
      const insurer = insurers.findOrCreate(conn, "Star Health");
      const first = policies.create(conn, samplePolicy(client, insurer, "HS/2026/001", "2027-03-31"));

      const second = policies.renew(conn, {
        policyId: first,
        policyNumber: "HS/2027/002",
        sumInsured: 1_500_000,
        premiumAmount: 27_000,
        notes: "Cover increased",
      });

      const old = policies.get(conn, first);
      const created = policies.get(conn, second);

      expect.equal(old.status, "renewed");
      expect.equal(old.premiumAmount, 24_500, "last year's premium must survive");
      expect.ok(old.isRenewed);

      expect.equal(created.policyYear, 2);
      expect.equal(created.previousPolicyId, first);
      expect.equal(created.chainId, old.chainId);
      expect.equal(created.startDate, "2027-04-01", "starts the day after expiry");
      expect.equal(created.expiryDate, "2028-03-31", "runs a year minus a day");
      expect.equal(created.sumInsured, 1_500_000);
      // Carried forward because the renewal did not restate it.
      expect.equal(created.commissionRate, 15);

      const chain = policies.chain(conn, second);
      expect.equal(chain.length, 2);
      expect.equal(chain[0]!.policyYear, 1, "oldest year first");

      const latest = policies.list(conn, { latestOnly: true });
      expect.equal(latest.total, 1, "the latest year is the one without a successor");
      expect.equal(latest.rows[0]!.id, second);
    });
    db.close();
  });

  test("keeps exactly one open year, whatever is asked of it", async () => {
    const db = tempDb("one-open-year");
    await db.with(async (conn) => {
      const client = clients.create(conn, sampleClient("Nikhil Joshi"));
      const insurer = insurers.findOrCreate(conn, "Care Health");
      const first = policies.create(conn, samplePolicy(client, insurer, "O-1", "2027-03-31"));
      const second = policies.renew(conn, { policyId: first, policyNumber: "O-2" });

      await throwsKind(
        "conflict",
        () => policies.renew(conn, { policyId: first, policyNumber: "O-3" }),
        "a year that has been renewed cannot be renewed again into a forked chain",
      );

      const chain = policies.chain(conn, second);
      expect.equal(chain.filter((policy) => !policy.isRenewed).length, 1);
    });
    db.close();
  });

  test("leaves a cancelled year saying so", async () => {
    const db = tempDb("renew-cancelled");
    await db.with(async (conn) => {
      const client = clients.create(conn, sampleClient("Imran Qureshi"));
      const insurer = insurers.findOrCreate(conn, "Star Health");
      const first = policies.create(conn, samplePolicy(client, insurer, "C-1", "2027-03-31"));
      policies.setStatus(conn, first, "cancelled");

      // The client came back and took cover again for the following year.
      const second = policies.renew(conn, { policyId: first, policyNumber: "C-2" });

      const cancelled = policies.get(conn, first);
      expect.equal(cancelled.status, "cancelled", "the book still says the cover was ended early");
      expect.ok(
        cancelled.isRenewed,
        "and still knows a later year replaced it, which is what keeps it off the renewals desk",
      );

      // The sweep must not talk it round either way.
      policies.syncStatuses(conn);
      expect.equal(policies.get(conn, first).status, "cancelled");

      const chain = policies.chain(conn, second);
      expect.equal(chain.filter((policy) => !policy.isRenewed).length, 1, "one open year, as in any chain");
    });
    db.close();
  });

  test("carries the members forward to the new year", () => {
    const db = tempDb("renew-members");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Sunita Nair"));
      const insurer = insurers.findOrCreate(conn, "Niva Bupa");
      const spouse = clients.create(conn, sampleClient("Ravi Nair"));
      relations.link(conn, {
        clientId: client,
        relatedClientId: spouse,
        relationship: "spouse",
      });
      const policy = policies.create(conn, {
        ...samplePolicy(client, insurer, "M-1", "2027-03-31"),
        insuredClientIds: [spouse],
      });

      const second = policies.renew(conn, { policyId: policy, policyNumber: "M-2" });
      expect.deepEqual(policies.insuredOf(conn, second), [spouse]);
    });
    db.close();
  });

  test("leaves an edited year in its place in the chain", () => {
    const db = tempDb("edit");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Kabir Malhotra"));
      const insurer = insurers.findOrCreate(conn, "ICICI Lombard");
      const first = policies.create(conn, samplePolicy(client, insurer, "E-1", "2027-03-31"));
      const second = policies.renew(conn, { policyId: first, policyNumber: "E-2" });

      const before = policies.get(conn, second);
      policies.update(conn, second, {
        ...samplePolicy(client, insurer, "E-2-corrected", "2028-03-31"),
        startDate: before.startDate,
      });

      const after = policies.get(conn, second);
      expect.equal(after.policyNumber, "E-2-corrected");
      expect.equal(after.policyYear, before.policyYear, "still the second year");
      expect.equal(after.previousPolicyId, first, "and still behind the first");
      expect.equal(after.chainId, before.chainId);
      expect.equal(policies.chain(conn, second).length, 2);
    });
    db.close();
  });

  test("is still the one the lists find after it is renumbered", () => {
    // Ported from `a_policy_renumbered_or_filled_in_is_still_the_one_the_lists_find`.
    // `policies_touch` nests an update the way `clients_touch` does, so it is worth
    // saying where the difference is: there is no search index on policies for it
    // to disturb, policy search being a LIKE over policy_overview. What this holds
    // is that, and the client index surviving a policy edited beside it.
    const db = tempDb("policy-edit-search");
    db.with((conn) => {
      const client = clients.create(conn, { fullName: "Ravi Bose" });
      const insurer = insurers.findOrCreate(conn, "Star Health");
      const id = policies.create(conn, samplePolicy(client, insurer, "SH/2026/1", "2027-03-31"));

      policies.update(conn, id, {
        ...samplePolicy(client, insurer, "SH/2026/1-A", "2027-03-31"),
        vehicleNumber: "MH 12 AB 3456",
      });

      const found = (search: string) => policies.list(conn, { search }).total;
      expect.equal(policies.get(conn, id).policyNumber, "SH/2026/1-A");
      expect.equal(found("SH/2026/1-A"), 1, "the number it now carries");
      expect.equal(found("MH 12 AB 3456"), 1, "and the vehicle just recorded");

      // The lists read the client's name through the view, so a rename has to
      // bring the policy with it.
      clients.update(conn, client, {
        fullName: "Ravi Kumar Sharma",
        email: "ravi@example.com",
        pan: "abcde1234f",
      });
      expect.equal(found("Sharma"), 1);
      expect.equal(found("Bose"), 0);
      expect.equal(clients.list(conn, { search: "Sharma" }).total, 1);
      conn.exec("INSERT INTO clients_fts(clients_fts) VALUES('integrity-check')");
    });
    db.close();
  });

  test("leaves the earlier years standing when a year is deleted", () => {
    const db = tempDb("delete-year");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Leela Menon"));
      const insurer = insurers.findOrCreate(conn, "Tata AIG");
      const first = policies.create(conn, samplePolicy(client, insurer, "D-1", "2027-03-31"));
      const second = policies.renew(conn, { policyId: first, policyNumber: "D-2" });

      policies.remove(conn, second);

      const remaining = policies.get(conn, first);
      expect.ok(!remaining.isRenewed, "with the successor gone it is the open year again");
      policies.syncStatuses(conn);
      expect.equal(
        policies.get(conn, first).status,
        "active",
        "and the sweep puts back the status the renewal took",
      );
    });
    db.close();
  });
});

suite("statuses follow the calendar", () => {
  test("names each policy by where its expiry falls", () => {
    const db = tempDb("status");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Vikram Rao"));
      const insurer = insurers.findOrCreate(conn, "HDFC ERGO");

      const lapsed = policies.create(conn, {
        ...samplePolicy(client, insurer, "A-1", daysFromToday(-90)),
        startDate: daysFromToday(-455),
      });
      const expired = policies.create(conn, {
        ...samplePolicy(client, insurer, "A-2", daysFromToday(-5)),
        startDate: daysFromToday(-370),
      });
      const active = policies.create(conn, samplePolicy(client, insurer, "A-3", daysFromToday(120)));

      policies.syncStatuses(conn);

      expect.equal(policies.get(conn, lapsed).status, "lapsed");
      expect.equal(policies.get(conn, expired).status, "expired");
      expect.equal(policies.get(conn, active).status, "active");

      const summary = dashboard.load(conn);
      expect.equal(summary.expiredUnrenewed, 2);
      expect.equal(summary.activePolicies, 1);
      expect.ok(
        summary.buckets.some((bucket) => bucket.label === "Overdue" && bucket.count === 2),
        "and the dashboard counts them where the desk looks",
      );
    });
    db.close();
  });

  test("holds the grace period exactly where the Rust core holds it", () => {
    const db = tempDb("grace");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Deepa Krishnan"));
      const insurer = insurers.findOrCreate(conn, "SBI General");

      // Thirty days is still within grace; thirty-one is not. Getting this off by
      // one moves a client between two screens.
      const inside = policies.create(conn, {
        ...samplePolicy(client, insurer, "G-30", daysFromToday(-30)),
        startDate: daysFromToday(-395),
      });
      const outside = policies.create(conn, {
        ...samplePolicy(client, insurer, "G-31", daysFromToday(-31)),
        startDate: daysFromToday(-396),
      });

      policies.syncStatuses(conn);

      expect.equal(policies.get(conn, inside).status, "expired", "thirty days is still in grace");
      expect.equal(policies.get(conn, outside).status, "lapsed", "thirty-one is not");
    });
    db.close();
  });

  test("expires nothing on its last day", () => {
    const db = tempDb("last-day");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Arjun Pillai"));
      const insurer = insurers.findOrCreate(conn, "Reliance General");
      const today = policies.create(conn, {
        ...samplePolicy(client, insurer, "T-0", daysFromToday(0)),
        startDate: daysFromToday(-365),
      });

      policies.syncStatuses(conn);
      expect.equal(
        policies.get(conn, today).status,
        "active",
        "cover that runs until today is cover the client still has",
      );
    });
    db.close();
  });

  test("leaves a cancelled policy alone in either direction", () => {
    const db = tempDb("cancelled");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Farah Sheikh"));
      const insurer = insurers.findOrCreate(conn, "HDFC ERGO");

      const longGone = policies.create(conn, {
        ...samplePolicy(client, insurer, "X-1", daysFromToday(-90)),
        startDate: daysFromToday(-455),
      });
      const current = policies.create(conn, samplePolicy(client, insurer, "X-2", daysFromToday(120)));

      policies.setStatus(conn, longGone, "cancelled");
      policies.setStatus(conn, current, "cancelled");
      policies.syncStatuses(conn);

      // Cancelling is a decision somebody made; the calendar does not overrule it.
      expect.equal(policies.get(conn, longGone).status, "cancelled");
      expect.equal(policies.get(conn, current).status, "cancelled");
      expect.equal(dashboard.load(conn).activePolicies, 0);
    });
    db.close();
  });

  test("brings a policy back when its expiry is corrected", () => {
    const db = tempDb("revive");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Tara Menon"));
      const insurer = insurers.findOrCreate(conn, "Bajaj Allianz");
      const start = daysFromToday(-370);
      const id = policies.create(conn, {
        ...samplePolicy(client, insurer, "R-1", daysFromToday(-5)),
        startDate: start,
      });

      policies.syncStatuses(conn);
      expect.equal(policies.get(conn, id).status, "expired");

      // The date was typed wrong and has been corrected.
      policies.update(conn, id, {
        ...samplePolicy(client, insurer, "R-1", daysFromToday(120)),
        startDate: start,
      });
      expect.equal(
        policies.get(conn, id).status,
        "expired",
        "an edit that says nothing about status does not decide one",
      );

      policies.syncStatuses(conn);
      expect.equal(
        policies.get(conn, id).status,
        "active",
        "the sweep reads the corrected date and puts it back",
      );
    });
    db.close();
  });

  test("reports how much it changed, so a sweep that does nothing says so", () => {
    const db = tempDb("sweep-count");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Yusuf Khan"));
      const insurer = insurers.findOrCreate(conn, "Star Health");
      policies.create(conn, {
        ...samplePolicy(client, insurer, "S-1", daysFromToday(-5)),
        startDate: daysFromToday(-370),
      });

      expect.equal(policies.syncStatuses(conn), 1);
      expect.equal(policies.syncStatuses(conn), 0, "and running it twice changes nothing");
    });
    db.close();
  });
});

suite("policy numbers and statuses", () => {
  test("refuses the same number twice for one insurer", async () => {
    const db = tempDb("dupe");
    await db.with(async (conn) => {
      const client = clients.create(conn, sampleClient("Meera Iyer"));
      const insurer = insurers.findOrCreate(conn, "Care Health");
      policies.create(conn, samplePolicy(client, insurer, "SAME-1", "2027-01-01"));

      const error = await throwsKind("conflict", () =>
        policies.create(conn, samplePolicy(client, insurer, "SAME-1", "2028-01-01")),
      );
      expect.ok(
        error.message.includes("Use Renew"),
        "and says what to do instead, because this is how a renewal gets typed by hand",
      );
    });
    db.close();
  });

  test("lets two insurers each use the same number", () => {
    const db = tempDb("number-scope");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Ishaan Bose"));
      const star = insurers.findOrCreate(conn, "Star Health");
      const care = insurers.findOrCreate(conn, "Care Health");
      expect.notEqual(star, care);

      policies.create(conn, samplePolicy(client, star, "POL-7", "2027-03-31"));
      policies.create(conn, samplePolicy(client, care, "POL-7", "2027-03-31"));
      expect.equal(policies.list(conn, { search: "POL-7" }).total, 2);
    });
    db.close();
  });

  test("accepts only the statuses the app knows", async () => {
    const db = tempDb("statuses");
    await db.with(async (conn) => {
      const client = clients.create(conn, sampleClient("Priya Shah"));
      const insurer = insurers.findOrCreate(conn, "Star Health");
      const id = policies.create(conn, samplePolicy(client, insurer, "ST-1", "2027-03-31"));

      for (const status of policies.STATUSES) {
        policies.setStatus(conn, id, status);
        expect.equal(policies.get(conn, id).status, status);
      }

      await throwsKind("validation", () => policies.setStatus(conn, id, "pending"));
      await throwsKind("not_found", () => policies.setStatus(conn, 9_999, "active"));
    });
    db.close();
  });

  test("refuses a policy the calendar could not make sense of", async () => {
    const db = tempDb("policy-validation");
    await db.with(async (conn) => {
      const client = clients.create(conn, sampleClient("Ganesh Iyer"));
      const insurer = insurers.findOrCreate(conn, "Star Health");

      await throwsKind("validation", () =>
        policies.create(conn, { ...samplePolicy(client, insurer, "", "2027-03-31") }),
      );
      await throwsKind("validation", () =>
        policies.create(conn, {
          ...samplePolicy(client, insurer, "V-1", "2027-03-31"),
          category: "spaceship",
        }),
      );
      await throwsKind(
        "validation",
        () => policies.create(conn, samplePolicy(client, insurer, "V-2", "2026-03-31")),
        "an expiry before the start is not a policy",
      );
      await throwsKind("validation", () =>
        policies.create(conn, { ...samplePolicy(client, insurer, "V-3", "not a date") }),
      );
      await throwsKind(
        "validation",
        () => policies.create(conn, samplePolicy(9_999, insurer, "V-4", "2027-03-31")),
        "and a policy needs a client that exists",
      );
    });
    db.close();
  });
});

suite("the lives a policy covers", () => {
  test("are its holder or someone related to them", () => {
    const db = tempDb("members");
    db.with((conn) => {
      const owner = clients.create(conn, sampleClient("Anil Kapoor"));
      const stranger = clients.create(conn, sampleClient("Sneha Reddy"));
      const insurer = insurers.findOrCreate(conn, "Niva Bupa");
      const policy = policies.create(conn, samplePolicy(owner, insurer, "MB-1", "2027-03-31"));

      const mine = relations.findOrCreateRelative(conn, owner, "Sonam Kapoor", "daughter");
      const theirs = relations.findOrCreateRelative(conn, stranger, "Rahul Reddy", "son");

      // The holder themselves, the daughter, and somebody from another family.
      policies.setMembers(conn, policy, [owner, mine, theirs]);

      expect.deepEqual(
        policies.insuredOf(conn, policy),
        [owner, mine].sort((a, b) => a - b),
        "the holder and his own family, and nobody else's",
      );

      const listed = relations.listForClient(conn, owner);
      expect.equal(listed.length, 1);
      expect.equal(listed[0]?.relationship, "daughter");
      expect.ok(
        listed[0]?.ownPolicies === 0 && listed[0]?.clientCode.startsWith("CL-"),
        "a life named on a policy became a client with a code of her own",
      );
    });
    db.close();
  });
});
