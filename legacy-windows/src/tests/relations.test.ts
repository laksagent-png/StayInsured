/**
 * Ported from `a_family_is_the_same_walked_from_any_of_them`,
 * `a_relationship_is_one_edge_however_many_times_it_is_recorded`,
 * `nobody_can_be_their_own_ancestor` and `a_life_named_on_a_policy_is_not_entered_twice`.
 *
 * A family is edges between clients, walked in code rather than by a recursive
 * query, so the walk exists twice and has to agree. This is the file that fails
 * when it does not.
 */

import fs from "node:fs";
import path from "node:path";

import * as importer from "../core/importer";
import * as clients from "../core/repo/clients";
import * as relations from "../core/repo/relations";
import { splitRelationship } from "../core/util";
import { expect, suite, test, throwsKind } from "./harness";
import { sampleClient, scalar, tempDb, tempDir } from "./support";

suite("a family", () => {
  test("is the same walked from any of them", () => {
    const db = tempDb("family-walk");
    db.with((conn) => {
      const grandfather = clients.create(conn, sampleClient("Mohan Kumar"));
      const holder = clients.create(conn, sampleClient("Rajesh Kumar"));
      const wife = clients.create(conn, sampleClient("Priya Kumar"));
      const son = clients.create(conn, sampleClient("Aarav Kumar"));
      const unrelated = clients.create(conn, sampleClient("Nobody Here"));

      for (const [a, b, relationship] of [
        [grandfather, holder, "son"],
        [holder, wife, "spouse"],
        [holder, son, "son"],
      ] as [number, number, string][]) {
        relations.link(conn, { clientId: a, relatedClientId: b, relationship });
      }

      // Three generations, entered from the middle and from the bottom. The old
      // member table could not answer the second question at all: a grandfather
      // was not reachable from a son.
      const fromHolder = relations.family(conn, holder);
      const fromSon = relations.family(conn, son);

      const idsFromHolder = fromHolder.members.map((m) => m.clientId).sort((a, b) => a - b);
      const idsFromSon = fromSon.members.map((m) => m.clientId).sort((a, b) => a - b);

      expect.deepEqual(
        idsFromHolder,
        idsFromSon,
        "the same four people whichever end the walk starts from",
      );
      expect.equal(idsFromHolder.length, 4);
      expect.ok(
        !idsFromHolder.includes(unrelated),
        "a client with no edge to the family is not in it",
      );

      expect.equal(
        fromSon.members.find((m) => m.clientId === grandfather)?.steps,
        2,
        "two edges from the son, and the tree says so",
      );
      expect.equal(fromSon.edges.length, 3, "every edge among the people found");
    });
    db.close();
  });

  test("records one edge however many times the relationship is entered", async () => {
    const db = tempDb("family-edges");
    await db.with(async (conn) => {
      const father = clients.create(conn, sampleClient("Rajesh Kumar"));
      const son = clients.create(conn, sampleClient("Aarav Kumar"));

      relations.link(conn, { clientId: father, relatedClientId: son, relationship: "son" });
      // The same fact entered from the son's page, the other way round.
      relations.link(conn, { clientId: son, relatedClientId: father, relationship: "father" });

      expect.equal(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM client_relations"),
        1,
        "one pair, one edge, whichever page recorded it",
      );

      const seen = relations.listForClient(conn, son);
      expect.equal(seen.length, 1);
      expect.equal(seen[0]?.relationship, "father");
      expect.ok(
        seen[0]?.outgoing,
        "the last word entered is the one stored, in the direction it was said",
      );

      // Read from the other side, the same edge is the same word, not its
      // opposite: "father of", which needs no gender to say.
      const fromFather = relations.listForClient(conn, father);
      expect.equal(fromFather[0]?.relationship, "father");
      expect.ok(!fromFather[0]?.outgoing);

      relations.unlink(conn, father, son);
      expect.equal(
        relations.listForClient(conn, father).length,
        0,
        "unlinking works whichever way round the edge is stored",
      );
      expect.equal(
        clients.get(conn, son).fullName,
        "Aarav Kumar",
        "and it takes the edge, not the person",
      );

      await throwsKind("not_found", () => relations.unlink(conn, father, son));
      await throwsKind("validation", () =>
        relations.link(conn, { clientId: father, relatedClientId: father, relationship: "son" }),
      );
      await throwsKind("validation", () =>
        relations.link(conn, { clientId: father, relatedClientId: son, relationship: "uncle" }),
      );
    });
    db.close();
  });

  test("cannot make anybody their own ancestor", async () => {
    const db = tempDb("family-loop");
    await db.with(async (conn) => {
      const grandfather = clients.create(conn, sampleClient("Mohan Kumar"));
      const father = clients.create(conn, sampleClient("Rajesh Kumar"));
      const son = clients.create(conn, sampleClient("Aarav Kumar"));

      for (const [a, b] of [
        [grandfather, father],
        [father, son],
      ] as [number, number][]) {
        relations.link(conn, { clientId: a, relatedClientId: b, relationship: "son" });
      }

      await throwsKind("validation", () =>
        relations.link(conn, {
          clientId: son,
          relatedClientId: grandfather,
          relationship: "son",
        }),
      );

      // A loop that is not ancestry is a family with two ways through it, and
      // stays allowed: cousins who marry are one family, not a fault.
      const cousin = clients.create(conn, sampleClient("Kavita Rao"));
      relations.link(conn, {
        clientId: grandfather,
        relatedClientId: cousin,
        relationship: "daughter",
      });
      relations.link(conn, { clientId: son, relatedClientId: cousin, relationship: "spouse" });
    });
    db.close();
  });

  test("takes a life named on a policy without entering them twice", () => {
    const db = tempDb("relative-names");
    db.with((conn) => {
      const holder = clients.create(conn, sampleClient("Rajesh Kumar"));

      const wife = relations.findOrCreateRelative(conn, holder, "Priya Kumar", "wife");
      const again = relations.findOrCreateRelative(conn, holder, "priya kumar", null);
      expect.equal(again, wife, "the same name in the same family is the same person");

      // The holder in their own cover list is the holder, not a second client of
      // the same name. This is what the old 'self' member row was for.
      expect.equal(relations.findOrCreateRelative(conn, holder, "Rajesh Kumar", null), holder);
      expect.equal(relations.findOrCreateRelative(conn, holder, "Someone Else", "proposer"), holder);

      expect.equal(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM clients"),
        2,
        "one household, two clients",
      );
      expect.equal(
        clients.get(conn, wife).city,
        "Pune",
        "somebody entered as a life on a policy lives where the policyholder lives",
      );
      expect.equal(relations.listForClient(conn, holder)[0]?.relationship, "spouse");

      // A relationship the file states corrects one that arrived blank, which is
      // what makes a re-import a way to repair a book rather than only a way to
      // avoid duplicating it.
      relations.findOrCreateRelative(conn, holder, "Priya Kumar", "mother");
      expect.equal(relations.listForClient(conn, holder)[0]?.relationship, "mother");
      relations.findOrCreateRelative(conn, holder, "Priya Kumar", null);
      expect.equal(
        relations.listForClient(conn, holder)[0]?.relationship,
        "mother",
        "a file that says nothing does not flatten it back to other",
      );
    });
    db.close();
  });

  test("reads a relationship written beside a name instead of swallowing it", () => {
    // Agency registers write the word next to the person. It used to become part of
    // the name: the book gained a client called "Sneha Sharma (wife)" and a second
    // copy of the policyholder called "Rohit Sharma (self)".
    const cases: [string, string, string | null][] = [
      ["Sneha Sharma (Wife)", "Sneha Sharma", "spouse"],
      ["Sneha Sharma [wife]", "Sneha Sharma", "spouse"],
      ["Wife - Sneha Sharma", "Sneha Sharma", "spouse"],
      ["Wife: Sneha Sharma", "Sneha Sharma", "spouse"],
      ["Sneha Sharma - wife", "Sneha Sharma", "spouse"],
      ["Aarav Sharma (son)", "Aarav Sharma", "son"],
      ["Rohit Sharma (Self)", "Rohit Sharma", "self"],
      ["Anne-Marie Fernandes", "Anne-Marie Fernandes", null],
      ["T. R. Krishnan", "T. R. Krishnan", null],
      ["Maria D'Souza & Sons", "Maria D'Souza & Sons", null],
      ["Priya Menon (nominee)", "Priya Menon (nominee)", null],
      ["Self", "", "self"],
      ["wife", "", "spouse"],
    ];

    for (const [entry, name, relationship] of cases) {
      expect.deepEqual(splitRelationship(entry), { name, relationship }, `reading ${entry}`);
    }
  });
});

suite("a cover list", () => {
  test("takes its relationships from the row it is on", () => {
    const dir = tempDir("cover-relationships");
    const file = path.join(dir, "cover.csv");
    fs.writeFileSync(
      file,
      [
        "Client name,Policy number,Insurer,Category,Expiry date,Nominee,Nominee relation,Covered members",
        // Two words written beside the name, one only in the nominee columns, the
        // holder named the way a register names them, and a cell with no person.
        "Rohit Sharma,P/1,Star Health,Health,31/12/2027,Lakshmi Sharma,Mother," +
          "Self; Sneha Sharma (Wife); son - Aarav Sharma; Lakshmi Sharma; Daughter",
      ].join("\n") + "\n",
    );

    const db = tempDb("cover-relationships");
    db.with((conn) => {
      const mapping = importer.preview(file, null).suggestedMapping;
      importer.run(conn, { path: file, mapping, updateExisting: true, dryRun: false });

      const holder = clients.list(conn, { search: "Rohit Sharma" }).rows[0];
      if (!holder) throw new Error("the policyholder is not in the book");

      const recorded = relations
        .listForClient(conn, holder.id)
        .map((r) => `${r.fullName}: ${r.relationship}`)
        .sort();
      expect.deepEqual(
        recorded,
        ["Aarav Sharma: son", "Lakshmi Sharma: mother", "Sneha Sharma: spouse"],
        "every relationship the row carried, and no client named after one",
      );

      expect.equal(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM clients"),
        4,
        "the holder and three lives — 'Self' is him, and 'Daughter' names nobody",
      );
      expect.equal(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM policy_members"),
        4,
        "the holder is covered once, by name and by 'Self'",
      );
    });
    db.close();
  });
});

/**
 * `sample-data/09-families.csv` exists to be imported by hand, and its README
 * states the shape it builds — how many people, how many relationships, who is
 * one step from whom. Those numbers are worked out by a simulation of this rule
 * in `scripts/sample-data.mjs`, which nothing else would notice drifting from the
 * rule itself. This is what notices.
 */
suite("the sample families file", () => {
  const file = path.join(__dirname, "..", "..", "..", "sample-data", "09-families.csv");

  test("builds the family its README describes", () => {
    if (!fs.existsSync(file)) {
      throw new Error(`${file} is missing — run npm run sample:data`);
    }

    const db = tempDb("sample-families");
    db.with((conn) => {
      const mapping = importer.preview(file, null).suggestedMapping;
      importer.run(conn, { path: file, mapping, updateExisting: true, dryRun: false });

      const everybody = clients.list(conn, { includeFamily: true, pageSize: 100 }).rows;
      const id = (name: string): number => {
        const found = everybody.find((c) => c.fullName === name);
        if (!found) throw new Error(`${name} is not in the imported book`);
        return found.id;
      };

      expect.equal(everybody.length, 9, "five policyholders and the four lives named beside them");
      expect.equal(clients.list(conn, {}).total, 5, "browsing shows the policyholders");
      expect.equal(scalar<number>(conn, "SELECT COUNT(*) AS n FROM client_relations"), 7);
      expect.equal(everybody.filter((c) => c.isDependent).length, 4);

      // The file writes the word beside each name, or leaves it to the nominee
      // columns, so nothing in it arrives as an undefined relationship. The
      // README says every one is named; this is what holds it to that.
      expect.equal(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM client_relations WHERE relationship = 'other'"),
        0,
        "every relationship in the sample file is one the file stated",
      );

      // Rajesh is named on his father's policy by the first row and holds three
      // policies of his own by the fourth, which is the file's whole point.
      expect.equal(relations.listForClient(conn, id("Rajesh Rangan")).length, 3);
      expect.deepEqual(
        relations
          .listForClient(conn, id("Rajesh Rangan"))
          .map((r) => `${r.relationship}${r.outgoing ? "" : " of"} ${r.fullName.split(" ")[0]}`)
          .sort(),
        ["son Aarav", "son of Mohan", "spouse Priya"],
        "read from his page: a father above him, a wife and a son beside him",
      );
      expect.ok(!clients.get(conn, id("Rajesh Rangan")).isDependent);

      const fromTheBottom = relations.family(conn, id("Aarav Rangan"));
      expect.equal(fromTheBottom.members.length, 6, "three generations and an in-law");
      expect.equal(
        fromTheBottom.members.find((m) => m.fullName === "Mohan Rangan")?.steps,
        2,
        "a grandfather the old member table could not reach from a grandson",
      );

      // Two households joined by a name common enough to catch the importer out.
      // The README tells the reader to unlink it, so it has to be there to unlink.
      expect.equal(relations.family(conn, id("Anil Kumar")).members.length, 3);

      expect.equal(
        relations.immediateIds(conn, id("Rajesh Rangan")).length,
        3,
        "so a family delete offers three, and stops before the in-laws",
      );
      expect.equal(clients.setFamilyArchived(conn, id("Rajesh Rangan"), true), 4);
      expect.ok(
        !clients.get(conn, id("Lakshmi Menon")).isArchived,
        "his wife's mother is her own household",
      );
    });
    db.close();
  });
});
