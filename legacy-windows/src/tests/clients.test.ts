/**
 * Ported from `client_codes_increment_and_dedupe_matching`,
 * `matching_prefers_the_code_then_the_email_then_the_phone`,
 * `archiving_puts_a_client_away_without_losing_them`,
 * `deleting_a_client_takes_their_policies_and_members_with_them`,
 * `a_client_code_belongs_to_one_client` and
 * `a_blank_field_is_stored_as_nothing_rather_than_as_empty_text`.
 *
 * The matching order is the one the importer depends on, and a client code is
 * what an agency writes on paper, so both have to behave the same in either
 * edition or a spreadsheet imported on Windows 7 builds a different book.
 */

import * as clients from "../core/repo/clients";
import * as insurers from "../core/repo/insurers";
import * as members from "../core/repo/members";
import * as policies from "../core/repo/policies";
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

  test("takes their policies and members when deleted", () => {
    const db = tempDb("cascade");
    db.with((conn) => {
      const id = clients.create(conn, sampleClient("Sana Khan"));
      const insurer = insurers.findOrCreate(conn, "Star Health");
      const member = members.create(conn, { clientId: id, fullName: "Imran Khan", relationship: "spouse" });
      const policy = policies.create(conn, {
        ...samplePolicy(id, insurer, "CS-1", "2027-03-31"),
        memberIds: [member],
      });

      clients.remove(conn, id);

      expect.equal(scalar<number>(conn, "SELECT COUNT(*) AS n FROM policies"), 0);
      expect.equal(scalar<number>(conn, "SELECT COUNT(*) AS n FROM insured_members"), 0);
      expect.equal(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM policy_members WHERE policy_id = ?", policy),
        0,
        "and nothing is left pointing at a policy that has gone",
      );
      expect.equal(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM insurers WHERE id = ?", insurer),
        1,
        "the insurer is not the client's to delete",
      );
    });
    db.close();
  });
});
