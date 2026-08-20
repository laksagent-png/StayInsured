/**
 * Ported from `a_family_is_the_same_walked_from_any_of_them`,
 * `a_relationship_is_one_edge_however_many_times_it_is_recorded`,
 * `nobody_can_be_their_own_ancestor` and `a_life_named_on_a_policy_is_not_entered_twice`.
 *
 * A family is edges between clients, walked in code rather than by a recursive
 * query, so the walk exists twice and has to agree. This is the file that fails
 * when it does not.
 */

import * as clients from "../core/repo/clients";
import * as relations from "../core/repo/relations";
import { expect, suite, test, throwsKind } from "./harness";
import { sampleClient, scalar, tempDb } from "./support";

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
    });
    db.close();
  });
});
