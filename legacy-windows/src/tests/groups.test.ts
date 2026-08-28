/**
 * Ported from the group cases in `src-tauri/src/tests.rs`:
 * `a_group_is_a_folder_and_a_family_is_not`,
 * `a_company_in_a_group_is_not_a_dependent`,
 * `deleting_a_group_leaves_its_companies_standing`,
 * `deleting_a_client_leaves_every_group_exactly_as_it_was`,
 * `archiving_a_group_moves_its_members_and_not_its_referrer`,
 * `a_group_records_its_head_without_making_them_a_client`,
 * `a_group_may_be_opened_before_anybody_knows_who_referred_it`,
 * `a_group_heads_details_are_held_to_the_same_shape_a_clients_are`,
 * `a_group_code_and_name_belong_to_one_group`,
 * `a_client_belongs_to_one_group_at_a_time`,
 * `editing_a_client_leaves_the_group_they_are_in_alone`,
 * `a_group_sums_the_book_of_its_members_and_not_its_referrer`,
 * `a_policy_does_not_cover_another_company_in_the_group`,
 * `a_company_is_a_client_without_a_date_of_birth` and
 * `a_group_list_is_searched_by_its_name_its_code_or_its_head`.
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
 * A company client, and a group of them under the man who brought them in.
 *
 * He is named on the group and is also, separately, somebody the agency insures.
 * That coincidence is the case that matters: the two facts must not touch, so
 * neither his policies nor his deletion may reach the group.
 */
function aGroupOfTwo(conn: Conn): {
  group: number;
  referrer: number;
  first: number;
  second: number;
} {
  const referrer = clients.create(conn, sampleClient("Anil Mehta"));
  const group = groups.create(conn, {
    name: "Sundaram Group",
    headName: "Anil Mehta",
    headDesignation: "Managing Partner",
  });
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
      const { group, first } = aGroupOfTwo(conn);

      const saved = groups.get(conn, group);
      expect.equal(saved.groupCode, "GR-00001");
      expect.equal(saved.members, 2, "the two companies, not the referrer");
      expect.equal(saved.headName, "Anil Mehta");
      expect.equal(saved.headDesignation, "Managing Partner");

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

  test("is left exactly as it was when a client is deleted", () => {
    const db = tempDb("group-client-delete");
    db.with((conn) => {
      const { group, referrer, first } = aGroupOfTwo(conn);

      clients.remove(conn, referrer);

      const saved = groups.get(conn, group);
      expect.equal(
        saved.headName,
        "Anil Mehta",
        "the head is written on the folder, so there is nothing for a deletion to reach",
      );
      expect.equal(saved.headDesignation, "Managing Partner");
      expect.equal(saved.members, 2);
      expect.equal(clients.get(conn, first).groupId, group);
    });
    db.close();
  });

  test("records its head without making them a client", () => {
    const db = tempDb("group-head-contact");
    db.with((conn) => {
      const before = clients.list(conn, {}).total;
      const group = groups.create(conn, {
        name: "Coromandel Group",
        headName: "Priya Iyer",
        headDesignation: "HR Manager",
        headPhone: "9876543210",
        headEmail: "priya@example.com",
      });

      const saved = groups.get(conn, group);
      expect.equal(saved.headName, "Priya Iyer");
      expect.equal(saved.headDesignation, "HR Manager");
      expect.equal(saved.headPhone, "9876543210");
      expect.equal(saved.headEmail, "priya@example.com");
      expect.equal(
        clients.list(conn, {}).total,
        before,
        "an HR manager worth ringing is not thereby somebody the agency insures",
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

  test("may be opened before anybody knows who referred it", () => {
    const db = tempDb("group-no-head");
    db.with((conn) => {
      const bare = groups.create(conn, { name: "Nobody's Group" });

      const saved = groups.get(conn, bare);
      expect.equal(saved.headName, null, "a folder may be opened before the story behind it is known");
      expect.equal(saved.headDesignation, null);
      expect.equal(saved.headPhone, null);
      expect.equal(saved.headEmail, null);

      // A field with nothing but spaces in it is the same as an empty one, and the
      // list should not have to know the difference.
      const spaces = groups.create(conn, { name: "Blank Group", headName: "   " });
      expect.equal(groups.get(conn, spaces).headName, null);
    });
    db.close();
  });

  test("owns its code and its name", async () => {
    const db = tempDb("group-codes");
    await db.with(async (conn) => {
      aGroupOfTwo(conn);

      await throwsKind("conflict", () => groups.create(conn, { name: "Sundaram Group" }));
      await throwsKind("conflict", () =>
        groups.create(conn, { groupCode: "GR-00001", name: "Another Group" }),
      );

      // The counter reads the highest code, so one typed by hand moves the
      // automatic ones past it rather than colliding.
      const next = groups.create(conn, { name: "Third Group" });
      expect.equal(groups.get(conn, next).groupCode, "GR-00002");
    });
    db.close();
  });

  test("holds a client at a time", async () => {
    const db = tempDb("group-membership");
    await db.with(async (conn) => {
      const { group, first } = aGroupOfTwo(conn);
      const other = groups.create(conn, { name: "Coromandel Group" });

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
      // The cover held by the man named as head is his, not the group's.
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

  test("is searched by its name, its code or its head", () => {
    const db = tempDb("group-search");
    db.with((conn) => {
      const { group } = aGroupOfTwo(conn);

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

suite("a group head's details", () => {
  test("are held to the same shape a client's are", async () => {
    const db = tempDb("group-head-shape");
    await db.with(async (conn) => {
      const group = groups.create(conn, {
        name: "Sundaram Group",
        headName: "anil  mehta",
        headPhone: "+91 98765-43210",
      });
      expect.equal(groups.get(conn, group).headName, "Anil Mehta");
      expect.equal(groups.get(conn, group).headPhone, "+919876543210");

      const refused = await throwsKind("validation", () =>
        groups.update(conn, group, {
          name: "Sundaram Group",
          headName: "Anil Mehta",
          headEmail: "mehta at example.com",
        }),
      );
      expect.equal(refused.message, "The group head's email is not an address");

      // Not knowing somebody's address is not the same as typing a wrong one, so
      // only the second is refused.
      groups.update(conn, group, {
        name: "Sundaram Group",
        headName: "Anil Mehta",
        headEmail: "  ",
      });
      expect.equal(groups.get(conn, group).headEmail, null);
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
