/**
 * Ported from `client_codes_increment_and_dedupe_matching`,
 * `matching_prefers_the_code_then_the_email_then_the_phone`,
 * `archiving_puts_a_client_away_without_losing_them`,
 * `deleting_a_client_takes_their_policies_but_leaves_their_family_standing`,
 * `deleting_a_family_reaches_one_step_and_stops`,
 * `archiving_a_family_moves_the_household_and_stops`,
 * `a_dependent_stops_being_one_by_holding_a_policy`,
 * `the_dashboard_counts_policyholders_not_people`,
 * `a_client_code_belongs_to_one_client`,
 * `a_blank_field_is_stored_as_nothing_rather_than_as_empty_text` and
 * `a_client_renamed_or_filled_in_is_still_the_one_the_search_finds`.
 *
 * The matching order is the one the importer depends on, and a client code is
 * what an agency writes on paper, so both have to behave the same in either
 * edition or a spreadsheet imported on Windows 7 builds a different book.
 */

import * as clients from "../core/repo/clients";
import * as dashboard from "../core/repo/dashboard";
import * as insurers from "../core/repo/insurers";
import * as policies from "../core/repo/policies";
import * as relations from "../core/repo/relations";
import { expect, suite, test, throwsKind } from "./harness";
import { sampleClient, samplePolicy, scalar, tempDb } from "./support";

suite("client codes", () => {
  test("increment from one, in the format the agency reads out", () => {
    const db = tempDb("clients");
    db.with((conn) => {
      const first = clients.create(conn, sampleClient("Rohit Sharma"));
      const second = clients.create(conn, sampleClient("Anita Desai"));

      expect.deepEqual(
        [clients.get(conn, first).clientCode, clients.get(conn, second).clientCode],
        ["CL-00001", "CL-00002"],
      );
    });
    db.close();
  });

  test("belong to one client only", async () => {
    const db = tempDb("code-unique");
    await db.with(async (conn) => {
      clients.create(conn, { ...sampleClient("Asha Pillai"), clientCode: "CL-09000" });
      await throwsKind("conflict", () =>
        clients.create(conn, { ...sampleClient("Someone Else"), clientCode: "CL-09000" }),
      );
    });
    db.close();
  });

  test("count from the highest already used, not from the row count", () => {
    const db = tempDb("code-next");
    db.with((conn) => {
      clients.create(conn, { ...sampleClient("Asha Pillai"), clientCode: "CL-00042" });
      expect.equal(clients.nextClientCode(conn), "CL-00043");

      // A code that is not ours must not be read as a number.
      clients.create(conn, { ...sampleClient("Bharat Rao"), clientCode: "LEGACY/7" });
      expect.equal(clients.nextClientCode(conn), "CL-00043");
    });
    db.close();
  });
});

suite("matching an incoming row to a client", () => {
  test("prefers the code, then the email, then the phone, then the name", () => {
    const db = tempDb("matching");
    db.with((conn) => {
      const byCode = clients.create(conn, {
        ...sampleClient("Asha Pillai"),
        clientCode: "CL-09000",
        phone: "90000 00001",
      });
      const byEmail = clients.create(conn, { ...sampleClient("Bharat Rao"), phone: "90000 00002" });
      const byPhone = clients.create(conn, {
        ...sampleClient("Chitra Sen"),
        email: null,
        phone: "+91 90000 00003",
      });
      const byName = clients.create(conn, { ...sampleClient("Zara Khan"), email: null, phone: null });

      // Each client answers to exactly one of the four, so whichever comes back
      // names the step of the order that decided it.
      expect.equal(
        clients.findMatch(conn, "CL-09000", "bharat.rao@example.com", "+919000000003", "Zara Khan"),
        byCode,
      );
      expect.equal(
        clients.findMatch(conn, null, "bharat.rao@example.com", "+919000000003", "Zara Khan"),
        byEmail,
      );
      expect.equal(clients.findMatch(conn, null, null, "+919000000003", "Zara Khan"), byPhone);
      expect.equal(clients.findMatch(conn, null, null, null, "zara khan"), byName, "case is ignored");
      expect.equal(clients.findMatch(conn, null, null, null, "Nobody At All"), null);

      expect.equal(
        clients.findMatch(conn, "CL-99999", "BHARAT.RAO@EXAMPLE.COM", null, "Nobody At All"),
        byEmail,
        "an unknown code keeps looking, and email ignores case",
      );
    });
    db.close();
  });

  test("compares the phone exactly, so the caller has to normalise it first", () => {
    const db = tempDb("phone-match");
    db.with((conn) => {
      const id = clients.create(conn, { ...sampleClient("Ela Bhatt"), phone: "+91 98765-43210" });

      // Writing normalises and matching does not, which is a trap rather than a
      // decision — but it is the Rust core's trap too, and the importer that will
      // call this has to normalise before it does. Changing it here alone would put
      // the two editions' imports out of step.
      expect.equal(clients.findMatch(conn, null, null, "+919876543210", "Not This"), id);
      expect.equal(clients.findMatch(conn, null, null, "+91 98765-43210", "Not This"), null);
    });
    db.close();
  });
});

suite("searching and filtering", () => {
  test("finds a client by part of their name", () => {
    const db = tempDb("client-search");
    db.with((conn) => {
      clients.create(conn, sampleClient("Rohit Sharma"));
      clients.create(conn, sampleClient("Anita Desai"));

      const page = clients.list(conn, { search: "rohit" });
      expect.equal(page.total, 1);
      expect.equal(page.rows[0]!.fullName, "Rohit Sharma");
    });
    db.close();
  });

  test("puts a client away without losing them", () => {
    const db = tempDb("archive");
    db.with((conn) => {
      const id = clients.create(conn, sampleClient("Ravi Verma"));
      clients.setArchived(conn, id, true);

      expect.equal(clients.list(conn, {}).total, 0, "the book does not show them");
      expect.equal(clients.list(conn, { includeArchived: true }).total, 1, "but still has them");
      expect.ok(clients.get(conn, id).isArchived);

      clients.setArchived(conn, id, false);
      expect.equal(clients.list(conn, {}).total, 1);
    });
    db.close();
  });

  test("lists the cities the book actually has", () => {
    const db = tempDb("cities");
    db.with((conn) => {
      clients.create(conn, { ...sampleClient("Rohit Sharma"), city: "Pune" });
      clients.create(conn, { ...sampleClient("Anita Desai"), city: "Mumbai" });
      clients.create(conn, { ...sampleClient("Vikas Rao"), city: "Pune" });
      clients.create(conn, { ...sampleClient("Nobody Anywhere"), city: "  " });

      expect.deepEqual(clients.distinctCities(conn), ["Mumbai", "Pune"]);
    });
    db.close();
  });
});

suite("a client's record", () => {
  test("stores a blank field as nothing rather than as empty text", () => {
    const db = tempDb("blank");
    db.with((conn) => {
      const id = clients.create(conn, {
        fullName: "Nitin Gokhale",
        email: "   ",
        phone: "",
        city: "  ",
        notes: "",
      });

      const client = clients.get(conn, id);
      expect.equal(client.email, null);
      expect.equal(client.phone, null);
      expect.equal(client.city, null);
      // A filter for a missing email has to find it, which it cannot if the column
      // holds two spaces.
      expect.equal(clients.list(conn, { missingEmail: true }).total, 1);
    });
    db.close();
  });

  test("can be renamed and filled in, and the search follows", () => {
    // Ported from `a_client_renamed_or_filled_in_is_still_the_one_the_search_finds`.
    // This edition is where the fault showed: on SQLite 3.43 as on 3.51, an edit
    // that gave a client words in a column the whole book held none of was refused
    // with "database disk image is malformed", because the old update trigger ran
    // twice and took those words off the index's count before they were ever on
    // it. 004 is what stops the second run.
    const db = tempDb("client-edit-search");
    db.with((conn) => {
      const id = clients.create(conn, { fullName: "Rohit Bose" });

      clients.update(conn, id, {
        fullName: "Rohit Kumar Sharma",
        email: "rohit@example.com",
        phone: "98765 43210",
        pan: "abcde1234f",
      });

      const saved = clients.get(conn, id);
      expect.equal(saved.fullName, "Rohit Kumar Sharma");
      expect.equal(saved.email, "rohit@example.com");
      expect.equal(saved.pan, "ABCDE1234F");

      const found = (search: string) => clients.list(conn, { search }).total;
      expect.equal(found("Sharma"), 1, "the name they now go by finds them");
      expect.equal(found("ABCDE1234F"), 1, "and so does a field just filled in");
      expect.equal(found("9876543210"), 1);
      expect.equal(found("Bose"), 0, "the name they no longer go by does not");

      // Reads the index against itself and not against the clients table, so the
      // searches above are the half that says it is right and this is the half
      // that says it is sound.
      conn.exec("INSERT INTO clients_fts(clients_fts) VALUES('integrity-check')");

      // The WHEN clause is on the index trigger, not on clients_touch.
      conn.exec("UPDATE clients SET created_at = '2000-01-01 00:00:00'");
      const stamps = conn.prepare("SELECT created_at, updated_at FROM clients").get() as {
        created_at: string;
        updated_at: string;
      };
      expect.ok(stamps.updated_at > stamps.created_at, "an edit still moves updated_at");
    });
    db.close();
  });

  test("refuses a record that could not be used", async () => {
    const db = tempDb("client-validation");
    await db.with(async (conn) => {
      await throwsKind("validation", () => clients.create(conn, { fullName: "   " }));
      await throwsKind("validation", () =>
        clients.create(conn, { ...sampleClient("Bad Address"), email: "not an email" }),
      );
      await throwsKind("not_found", () => clients.get(conn, 9_999));
      await throwsKind("not_found", () => clients.remove(conn, 9_999));
    });
    db.close();
  });

  test("takes their policies when deleted, and leaves their family standing", () => {
    const db = tempDb("cascade");
    db.with((conn) => {
      const id = clients.create(conn, sampleClient("Sana Khan"));
      const insurer = insurers.findOrCreate(conn, "Star Health");
      const husband = clients.create(conn, sampleClient("Imran Khan"));
      relations.link(conn, {
        clientId: id,
        relatedClientId: husband,
        relationship: "spouse",
      });
      const policy = policies.create(conn, {
        ...samplePolicy(id, insurer, "CS-1", "2027-03-31"),
        insuredClientIds: [id, husband],
      });

      clients.remove(conn, id);

      expect.equal(scalar<number>(conn, "SELECT COUNT(*) AS n FROM policies"), 0);
      expect.equal(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM client_relations"),
        0,
        "the relationship goes with the client it was recorded on",
      );
      expect.equal(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM policy_members WHERE policy_id = ?", policy),
        0,
        "and nothing is left pointing at a policy that has gone",
      );
      // The husband is a client, not a detail of his wife's record. Losing him
      // with her is what the old member table did, and what a book that has his
      // own motor policy next year cannot afford to do.
      expect.equal(
        clients.get(conn, husband).fullName,
        "Imran Khan",
        "the family stay in the book when the client they were listed under goes",
      );
      expect.equal(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM insurers WHERE id = ?", insurer),
        1,
        "the insurer is not the client's to delete",
      );
    });
    db.close();
  });

  test("can take the household with them, one step out and no further", () => {
    const db = tempDb("family-delete");
    db.with((conn) => {
      const holder = clients.create(conn, sampleClient("Rajesh Kumar"));
      const wife = clients.create(conn, sampleClient("Priya Kumar"));
      const son = clients.create(conn, sampleClient("Aarav Kumar"));
      // One step further out: the wife's father, connected to the holder only
      // through her.
      const fatherInLaw = clients.create(conn, sampleClient("Suresh Rao"));

      for (const [a, b, relationship] of [
        [holder, wife, "spouse"],
        [holder, son, "son"],
        [wife, fatherInLaw, "father"],
      ] as [number, number, string][]) {
        relations.link(conn, { clientId: a, relatedClientId: b, relationship });
      }

      const deleted = clients.removeWithImmediateFamily(conn, holder);
      expect.equal(deleted.length, 3, "the holder, the wife and the son");

      // The whole family is reachable from the holder, so a walk would have taken
      // the father-in-law too. Recording an in-law must not widen what a delete
      // removes.
      expect.equal(
        clients.get(conn, fatherInLaw).fullName,
        "Suresh Rao",
        "one step out, so an in-law reached only through the wife stays",
      );
    });
    db.close();
  });

  test("moves the household in and out of the archive together", () => {
    const db = tempDb("family-archive");
    db.with((conn) => {
      const holder = clients.create(conn, sampleClient("Rajesh Kumar"));
      const wife = clients.create(conn, sampleClient("Priya Kumar"));
      const fatherInLaw = clients.create(conn, sampleClient("Suresh Rao"));
      relations.link(conn, { clientId: holder, relatedClientId: wife, relationship: "spouse" });
      relations.link(conn, {
        clientId: wife,
        relatedClientId: fatherInLaw,
        relationship: "father",
      });

      expect.equal(clients.setFamilyArchived(conn, holder, true), 2, "the holder and his wife");
      expect.ok(clients.get(conn, holder).isArchived, "the holder is put away");
      expect.ok(clients.get(conn, wife).isArchived, "and so is his wife");
      expect.ok(
        !clients.get(conn, fatherInLaw).isArchived,
        "one step out, so the in-law is left where he is",
      );

      expect.equal(clients.setFamilyArchived(conn, holder, false), 2, "and it reverses");
      expect.ok(!clients.get(conn, holder).isArchived, "the holder comes back");
    });
    db.close();
  });

  test("shows the policyholders when browsing and everybody when asked by name", () => {
    const db = tempDb("dependents");
    db.with((conn) => {
      const holder = clients.create(conn, sampleClient("Rajesh Kumar"));
      const wife = clients.create(conn, sampleClient("Priya Kumar"));
      const insurer = insurers.findOrCreate(conn, "Niva Bupa");
      policies.create(conn, samplePolicy(holder, insurer, "NB-1", "2027-06-30"));
      relations.link(conn, { clientId: holder, relatedClientId: wife, relationship: "spouse" });

      expect.deepEqual(
        clients.list(conn, {}).rows.map((row) => row.fullName),
        ["Rajesh Kumar"],
        "browsing the book shows the policyholder, not the life on his floater",
      );

      // But asked for by name she is there. A book that held her and would not
      // admit it would be worse than one that never held her.
      const searched = clients.list(conn, { search: "Priya" });
      expect.equal(searched.rows.length, 1);
      expect.ok(searched.rows[0]?.isDependent, "and the row says why she was hidden");
      expect.equal(searched.rows[0]?.relatives, 1);

      expect.equal(
        clients.list(conn, { includeFamily: true }).total,
        2,
        "the toggle brings her into the list",
      );

      // Her own term plan makes her a policyholder, and nothing had to be
      // corrected for that to be true.
      policies.create(conn, samplePolicy(wife, insurer, "NB-2", "2027-09-30"));
      expect.equal(
        clients.list(conn, {}).total,
        2,
        "a dependent who buys cover appears without being reclassified",
      );
      expect.ok(!clients.get(conn, wife).isDependent);
    });
    db.close();
  });

  test("are what the dashboard counts, so a child is not a client to chase", () => {
    const db = tempDb("dashboard-holders");
    db.with((conn) => {
      const holder = clients.create(conn, sampleClient("Rajesh Kumar"));
      const insurer = insurers.findOrCreate(conn, "Niva Bupa");
      policies.create(conn, samplePolicy(holder, insurer, "NB-1", "2027-06-30"));

      const before = dashboard.load(conn);

      // A wife and a son on his floater. Both are clients, neither has an email
      // address, and neither is somebody the agency is failing to reach — so the
      // one figure on this screen meant to be acted on must not move.
      for (const [name, relationship] of [
        ["Priya Kumar", "spouse"],
        ["Aarav Kumar", "son"],
      ]) {
        const relative = clients.create(conn, { fullName: name as string });
        relations.link(conn, {
          clientId: holder,
          relatedClientId: relative,
          relationship: relationship as string,
        });
      }

      const after = dashboard.load(conn);
      expect.equal(after.totalClients, before.totalClients);
      expect.equal(after.activeClients, before.activeClients);
      expect.equal(after.clientsWithoutEmail, before.clientsWithoutEmail);

      // Until one of them buys cover of her own.
      const wife = scalar<number>(
        conn,
        "SELECT id AS n FROM clients WHERE full_name = 'Priya Kumar'",
      );
      policies.create(conn, samplePolicy(wife, insurer, "NB-2", "2027-09-30"));

      const counted = dashboard.load(conn);
      expect.equal(counted.totalClients, before.totalClients + 1);
      expect.equal(
        counted.clientsWithoutEmail,
        before.clientsWithoutEmail + 1,
        "a policyholder with no email address is worth chasing",
      );
    });
    db.close();
  });
});
