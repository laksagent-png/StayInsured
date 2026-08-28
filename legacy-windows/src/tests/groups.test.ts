/**
 * Ported from the group cases in `src-tauri/src/tests.rs`:
 * `a_group_is_a_folder_and_a_family_is_not`,
 * `a_company_in_a_group_is_not_a_dependent`,
 * `deleting_a_group_leaves_its_companies_standing`,
 * `deleting_the_referrer_leaves_the_group_standing`,
 * `archiving_a_group_moves_its_members_and_not_its_referrer`,
 * `a_group_needs_the_client_who_referred_it`,
 * `a_group_code_and_name_belong_to_one_group`,
 * `a_client_belongs_to_one_group_at_a_time`,
 * `editing_a_client_leaves_the_group_they_are_in_alone`,
 * `a_group_sums_the_book_of_its_members_and_not_its_referrer`,
 * `a_policy_does_not_cover_another_company_in_the_group`,
 * `a_company_is_a_client_without_a_date_of_birth` and
 * `a_group_list_is_searched_by_its_name_its_code_or_its_referrer`.
 *
 * A group is a row where a family is edges, and the two must not reach into each
 * other. This is the file that fails when they do.
 */

import type { Conn } from "../core/db";
import * as clients from "../core/repo/clients";
import * as groups from "../core/repo/groups";
import * as insurers from "../core/repo/insurers";
import * as policies from "../core/repo/policies";
import * as relations from "../core/repo/relations";
import { expect, suite, test, throwsKind } from "./harness";
import { sampleClient, samplePolicy, tempDb } from "./support";

/**
 * A company client, and a group of them under the referrer who brought them in.
 * The referrer is left outside the group, which is the case that matters.
 */
function aGroupOfTwo(conn: Conn): {
  group: number;
  referrer: number;
  first: number;
  second: number;
} {
  const referrer = clients.create(conn, sampleClient("Anil Mehta"));
  const group = groups.create(conn, { name: "Sundaram Group", headClientId: referrer });
  const first = clients.create(conn, {
    ...sampleClient("Sundaram Textiles"),
    kind: "company",
    groupId: group,
  });
  const second = clients.create(conn, {
    ...sampleClient("Sundaram Logistics"),
    kind: "company",
    groupId: group,
  });
  return { group, referrer, first, second };
}

suite("a group", () => {
  test("is a folder, where a family is not", () => {
    const db = tempDb("group-shape");
    db.with((conn) => {
      const { group, referrer, first } = aGroupOfTwo(conn);

      const saved = groups.get(conn, group);
      expect.equal(saved.groupCode, "GR-00001");
      expect.equal(saved.members, 2, "the two companies, not the referrer");
      expect.equal(saved.headClientId, referrer);
      expect.equal(saved.headName, "Anil Mehta");

      // The whole point of the separation: being in a group is not being related
      // to anybody. Nothing the family code walks has changed.
      const company = clients.get(conn, first);
      expect.equal(company.relatives, 0);
      expect.equal(company.groupName, "Sundaram Group");
      expect.equal(company.kind, "company");
      expect.equal(relations.listForClient(conn, first).length, 0);
      expect.equal(
        relations.family(conn, first).members.length,
        1,
        "a company's family is itself, however many firms share its folder",
      );
    });
    db.close();
  });

  test("holds companies that are not dependents", () => {
    const db = tempDb("group-dependents");
    db.with((conn) => {
      const { first } = aGroupOfTwo(conn);

      expect.ok(
        !clients.get(conn, first).isDependent,
        "a subsidiary yet to place cover is still a client in its own right",
      );

      // Browsing hides dependents. It must not hide these.
      const browsed = clients.list(conn, {});
      expect.ok(
        browsed.rows.some((row) => row.id === first),
        "a company holding no policy yet is still browsed to",
      );
    });
    db.close();
  });

  test("leaves its companies standing when deleted", () => {
    const db = tempDb("group-delete");
    db.with((conn) => {
      const { group, first, second } = aGroupOfTwo(conn);

      expect.equal(groups.remove(conn, group), 2, "and it says how many it let go");

      for (const company of [first, second]) {
        const saved = clients.get(conn, company);
        expect.equal(saved.groupId, null, "out of the folder");
        expect.equal(saved.groupName, null);
      }
    });
    db.close();
  });

  test("stands when the referrer is deleted", async () => {
    const db = tempDb("group-referrer-delete");
    await db.with(async (conn) => {
      const { group, referrer, first } = aGroupOfTwo(conn);

      clients.remove(conn, referrer);

      const saved = groups.get(conn, group);
      expect.equal(saved.headClientId, null, "the introducer is gone and the group is not");
      expect.equal(saved.members, 2);
      expect.equal(clients.get(conn, first).groupId, group);

      // Naming a new referrer is how such a group is put right, and it is asked
      // for rather than left blank.
      await throwsKind("validation", () =>
        groups.update(conn, group, { name: "Sundaram Group", headClientId: null }),
      );
    });
    db.close();
  });

  test("archives its members and leaves its referrer alone", () => {
    const db = tempDb("group-archive");
    db.with((conn) => {
      const { group, referrer, first, second } = aGroupOfTwo(conn);

      expect.equal(groups.setArchived(conn, group, true), 2);
      expect.ok(clients.get(conn, first).isArchived);
      expect.ok(clients.get(conn, second).isArchived);
      expect.ok(groups.get(conn, group).isArchived);
      expect.ok(
        !clients.get(conn, referrer).isArchived,
        "the introducer is not part of the book he introduced",
      );

      expect.equal(groups.setArchived(conn, group, false), 2, "and it reverses");
      expect.ok(!clients.get(conn, first).isArchived);
    });
    db.close();
  });

  test("needs the client who referred it", async () => {
    const db = tempDb("group-head-required");
    await db.with(async (conn) => {
      await throwsKind("validation", () =>
        groups.create(conn, { name: "Nobody's Group", headClientId: null }),
      );
      await throwsKind(
        "validation",
        () => groups.create(conn, { name: "Ghost Group", headClientId: 9_999 }),
        "a referrer who is not in the book is refused in words, not by a foreign key",
      );
    });
    db.close();
  });

  test("owns its code and its name", async () => {
    const db = tempDb("group-codes");
    await db.with(async (conn) => {
      const { referrer } = aGroupOfTwo(conn);

      await throwsKind("conflict", () =>
        groups.create(conn, { name: "Sundaram Group", headClientId: referrer }),
      );
      await throwsKind("conflict", () =>
        groups.create(conn, {
          groupCode: "GR-00001",
          name: "Another Group",
          headClientId: referrer,
        }),
      );

      // The counter reads the highest code, so one typed by hand moves the
      // automatic ones past it rather than colliding.
      const next = groups.create(conn, { name: "Third Group", headClientId: referrer });
      expect.equal(groups.get(conn, next).groupCode, "GR-00002");
    });
    db.close();
  });

  test("holds a client at a time", async () => {
    const db = tempDb("group-membership");
    await db.with(async (conn) => {
      const { group, referrer, first } = aGroupOfTwo(conn);
      const other = groups.create(conn, { name: "Coromandel Group", headClientId: referrer });

      groups.setClientGroup(conn, first, other);
      expect.equal(clients.get(conn, first).groupId, other);
      expect.equal(groups.get(conn, group).members, 1, "moved, not copied");
      expect.equal(groups.get(conn, other).members, 1);

      groups.setClientGroup(conn, first, null);
      expect.equal(clients.get(conn, first).groupId, null);
      expect.equal(groups.get(conn, other).members, 0);

      await throwsKind("not_found", () => groups.setClientGroup(conn, first, 9_999));
    });
    db.close();
  });

  test("is not emptied by a client form that draws no group", () => {
    const db = tempDb("group-untouched");
    db.with((conn) => {
      const { group, first } = aGroupOfTwo(conn);

      clients.update(conn, first, {
        ...sampleClient("Sundaram Textiles"),
        kind: "company",
        groupId: null,
        phone: "99887 76655",
      });

      const saved = clients.get(conn, first);
      expect.equal(saved.groupId, group, "still in the folder");
      expect.equal(saved.phone, "9988776655");
    });
    db.close();
  });

  test("sums the book of its members and not its referrer", () => {
    const db = tempDb("group-rollup");
    db.with((conn) => {
      const { group, referrer, first, second } = aGroupOfTwo(conn);
      const insurer = insurers.findOrCreate(conn, "Niva Bupa");

      policies.create(conn, samplePolicy(first, insurer, "G-1", "2027-06-30"));
      policies.create(conn, samplePolicy(second, insurer, "G-2", "2027-03-31"));
      // The referrer's own cover is his, not the group's.
      policies.create(conn, samplePolicy(referrer, insurer, "G-3", "2026-12-31"));
      policies.syncStatuses(conn);

      const saved = groups.get(conn, group);
      expect.equal(saved.totalPolicies, 2);
      expect.equal(saved.activePolicies, 2);
      expect.equal(saved.premiumUnderManagement, 49_000);
      expect.equal(saved.nextExpiry, "2027-03-31", "the nearest renewal among the members");
    });
    db.close();
  });

  test("is searched by its name, its code or its referrer", () => {
    const db = tempDb("group-search");
    db.with((conn) => {
      const { group, referrer } = aGroupOfTwo(conn);

      // Headship read from the referrer's end, which is what makes a group
      // head's page possible without a command of its own.
      const referred = groups.list(conn, { headClientId: referrer });
      expect.equal(referred.total, 1);
      expect.equal(referred.rows[0]?.id, group);
      expect.equal(
        groups.list(conn, { headClientId: 9_999 }).total,
        0,
        "a client who introduced nobody heads nothing",
      );

      for (const term of ["Sundaram", "GR-00001", "Mehta"]) {
        const found = groups.list(conn, { search: term });
        expect.equal(found.total, 1, `searching for ${term}`);
        expect.equal(found.rows[0]?.id, group);
      }

      groups.setArchived(conn, group, true);
      expect.equal(
        groups.list(conn, {}).total,
        0,
        "an archived group is out of the way until it is asked for",
      );
      expect.equal(groups.list(conn, { includeArchived: true }).total, 1);
    });
    db.close();
  });
});

suite("group membership", () => {
  test("does not make one company a life on another's policy", () => {
    const db = tempDb("group-cover");
    db.with((conn) => {
      const { first, second } = aGroupOfTwo(conn);
      const insurer = insurers.findOrCreate(conn, "Niva Bupa");
      const policy = policies.create(conn, samplePolicy(first, insurer, "G-1", "2027-06-30"));

      policies.setMembers(conn, policy, [first, second]);
      expect.deepEqual(
        policies.insuredOf(conn, policy),
        [first],
        "the holder, and not the firm that merely shares its folder",
      );
    });
    db.close();
  });
});

suite("a company", () => {
  test("is a client without a date of birth", () => {
    const db = tempDb("company-kind");
    db.with((conn) => {
      const company = clients.create(conn, {
        ...sampleClient("Sundaram Textiles"),
        kind: "Pvt Ltd",
        contactPerson: "meera  raghavan",
        contactDesignation: "HR Manager",
        registrationNo: "u72900tn2011ptc079... ",
        gstin: "33aabcs1429b1zn",
      });

      const saved = clients.get(conn, company);
      expect.equal(saved.kind, "company", "however the register spells it");
      expect.equal(saved.contactPerson, "Meera Raghavan");
      expect.equal(saved.contactDesignation, "HR Manager");
      expect.equal(saved.gstin, "33AABCS1429B1ZN");
      expect.ok(saved.dateOfBirth === null && saved.gender === null);

      // A payload that says nothing is describing a person, which is what every
      // client entered before companies existed was.
      const person = clients.create(conn, sampleClient("Rajesh Kumar"));
      expect.equal(clients.get(conn, person).kind, "individual");

      const onlyFirms = clients.list(conn, { kind: "company" });
      expect.equal(onlyFirms.total, 1);
      expect.equal(onlyFirms.rows[0]?.id, company);

      // A word the book does not know is dropped, so an out-of-date screen shows
      // the book rather than nothing at all.
      expect.equal(clients.list(conn, { kind: "charity" }).total, 2);
    });
    db.close();
  });
});
