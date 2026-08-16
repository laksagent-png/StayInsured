/**
 * `a_page_size_stays_within_what_a_screen_can_draw`,
 * `sorting_can_only_name_a_column_the_code_chose`,
 * `a_filter_drops_a_value_the_code_does_not_know` and
 * `a_search_for_a_percent_sign_looks_for_a_percent_sign`.
 *
 * These are the boundary between the renderer and SQL. In this edition the
 * renderer is a Chromium window rather than a webview, but it is still the place
 * a sort key or a filter value arrives from, so the allow-lists matter for the
 * same reason and are checked the same way.
 */

import { Conditions, inClause, likePattern, orderBy, paginate } from "../core/query";
import * as clients from "../core/repo/clients";
import * as insurers from "../core/repo/insurers";
import * as policies from "../core/repo/policies";
import { STATUSES } from "../core/repo/policies";
import { expect, suite, test } from "./harness";
import { sampleClient, samplePolicy, tempDb } from "./support";

const ALLOWED = { name: "c.full_name", city: "c.city" };

suite("pagination", () => {
  test("clamps a page size to what a screen can draw", () => {
    expect.deepEqual(paginate(null, null), { page: 1, pageSize: 50, limit: 50, offset: 0 });
    expect.deepEqual(paginate(3, 20), { page: 3, pageSize: 20, limit: 20, offset: 40 });
    expect.deepEqual(
      paginate(0, 0),
      { page: 1, pageSize: 1, limit: 1, offset: 0 },
      "a page of nothing would return nothing however far it was paged",
    );
    expect.deepEqual(
      paginate(1, 5_000),
      { page: 1, pageSize: 500, limit: 500, offset: 0 },
      "and a page big enough to load the whole book is capped",
    );
  });
});

suite("sorting", () => {
  test("can only name a column the code chose", () => {
    expect.equal(orderBy("name", false, ALLOWED, "c.id"), " ORDER BY c.full_name ASC");
    expect.equal(orderBy("city", true, ALLOWED, "c.id"), " ORDER BY c.city DESC");
    expect.equal(orderBy(null, false, ALLOWED, "c.id"), " ORDER BY c.id ASC");
    expect.equal(
      orderBy("c.full_name; DROP TABLE clients", false, ALLOWED, "c.id"),
      " ORDER BY c.id ASC",
      "anything not on the list falls back rather than reaching the SQL text",
    );
  });

  test("cannot be tricked by a key that names an inherited property", () => {
    // `allowed[requested]` on a plain object would answer "constructor" or
    // "toString" with something from the prototype, and that string would then be
    // interpolated into the query.
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect.equal(orderBy(key, false, ALLOWED, "c.id"), " ORDER BY c.id ASC", key);
    }
  });
});

suite("filters", () => {
  test("drops a value the code does not know", () => {
    const mixed = inClause("p.status", ["Active", "teapot", " expired "], STATUSES);
    expect.ok(mixed !== null, "two of the three are real statuses");
    expect.equal(mixed.clause, "p.status IN (?, ?)");
    expect.deepEqual(
      mixed.params,
      ["active", "expired"],
      "case and space are tidied, and the invented one is dropped",
    );

    expect.equal(
      inClause("p.status", ["teapot"], STATUSES),
      null,
      "with nothing left the filter is dropped rather than matching nothing",
    );
  });

  test("builds a WHERE clause only when it has something to say", () => {
    const empty = new Conditions();
    expect.equal(empty.whereSql(), "");

    const one = new Conditions();
    one.add("client_id = ?", 4);
    one.addRaw("is_renewed = 0");
    expect.equal(one.whereSql(), " WHERE client_id = ? AND is_renewed = 0");
    expect.deepEqual(one.params(), [4]);
    expect.deepEqual(one.paramsWith([50, 0]), [4, 50, 0], "pagination binds last");
  });
});

suite("searching", () => {
  test("looks for a percent sign rather than obeying one", () => {
    expect.equal(likePattern("50%"), "%50\\%%");
    expect.equal(likePattern("a_b"), "%a\\_b%");
    expect.equal(likePattern("back\\slash"), "%back\\\\slash%");
    expect.equal(likePattern("  Rohit  "), "%Rohit%");
  });

  test("and the escape reaches the query", () => {
    const db = tempDb("search-escape");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Ananya Sharma"));
      const insurer = insurers.findOrCreate(conn, "Star Health");
      policies.create(conn, samplePolicy(client, insurer, "PCT-50%-A", "2027-03-31"));
      policies.create(conn, samplePolicy(client, insurer, "PCT-5000-B", "2027-03-31"));

      const found = policies.list(conn, { search: "50%" });
      expect.equal(found.total, 1, "the wildcard is looked for, not obeyed");
      expect.equal(found.rows[0]!.policyNumber, "PCT-50%-A");

      const both = policies.list(conn, { search: "PCT-" });
      expect.equal(both.total, 2);
    });
    db.close();
  });
});
