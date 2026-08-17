/**
 * Ported from `a_book_edited_before_the_fix_has_its_search_index_put_right`.
 *
 * Every other database test here starts from a book this build made, which is the
 * one book nobody has. An agency running 0.0.3 has a file that was migrated to
 * version 3 months ago and has been edited against the old client search trigger
 * ever since, so what has to be shown is that opening the app once — no export, no
 * re-import, nothing asked of them — puts that file right.
 *
 * The migration is driven through `Database.open`, the same path the app takes on
 * startup, rather than by executing the SQL directly, so this also holds the two
 * editions to the same version number: the file is stamped 3 here and has to come
 * back stamped whatever `LATEST_VERSION` says.
 */

import fs from "node:fs";
import path from "node:path";

import Sqlite from "better-sqlite3";

import { Database } from "../core/db";
import * as clients from "../core/repo/clients";
import { LATEST_VERSION, MIGRATIONS } from "../core/schema";
import { expect, suite, test } from "./harness";
import { schemaDir, tempDir } from "./support";

/** `clients_fts_au` as `001_init.sql` created it, before 004 gave it a WHEN clause. */
const OLD_TRIGGER = `
CREATE TRIGGER clients_fts_au AFTER UPDATE ON clients BEGIN
    INSERT INTO clients_fts (clients_fts, rowid, full_name, email, phone, client_code, pan)
    VALUES ('delete', old.id, old.full_name, old.email, old.phone, old.client_code, old.pan);
    INSERT INTO clients_fts (rowid, full_name, email, phone, client_code, pan)
    VALUES (new.id, new.full_name, new.email, new.phone, new.client_code, new.pan);
END;`;

/**
 * A file as 0.0.3 left it: migrated as far as 003, holding one client, and with an
 * index that no longer agrees with them. The disagreement is written by editing
 * with the index trigger out of the way, which is the state an edit under the old
 * trigger could leave behind on a build that did not refuse it.
 */
function bookFromTheField(file: string): void {
  const db = new Sqlite(file);
  for (const [index, name] of MIGRATIONS.entries()) {
    const version = index + 1;
    if (version > 3) break;
    db.exec(fs.readFileSync(path.join(schemaDir(), name), "utf8"));
    db.exec(`PRAGMA user_version = ${version}`);
  }

  db.prepare("INSERT INTO clients (client_code, full_name) VALUES ('CL-00001', 'Rohit Bose')").run();
  db.exec("DROP TRIGGER clients_fts_au");
  db.prepare("UPDATE clients SET full_name = 'Rohit Kumar Sharma' WHERE id = 1").run();
  db.exec(OLD_TRIGGER);
  db.close();
}

suite("a book carried over from 0.0.3", () => {
  test("has its client search index put right when the app opens it", () => {
    const file = path.join(tempDir("damaged-index"), "book.db");
    bookFromTheField(file);

    // Before anything is done to it, so the repair below is measured against
    // something rather than asserted into being.
    const damaged = new Sqlite(file);
    const hits = (term: string) =>
      damaged
        .prepare("SELECT rowid FROM clients_fts WHERE clients_fts MATCH ?")
        .all(term).length;
    expect.equal(damaged.pragma("user_version", { simple: true }), 3);
    expect.equal(hits("Sharma"), 0, "the index has not heard of the name the book holds");
    expect.equal(hits("Bose"), 1, "and still answers to the one it does not");
    // Nothing reports this. FTS5's integrity-check reads the index against itself,
    // so a book in this state looks well — which is why 004 rebuilds every book
    // instead of trying to pick out the bad ones.
    damaged.exec("INSERT INTO clients_fts(clients_fts) VALUES('integrity-check')");
    // And the fault itself, in the form an operator meets it.
    expect.throws(
      () => damaged.prepare("UPDATE clients SET pan = 'ABCDE1234F' WHERE id = 1").run(),
      /malformed/,
      "the old trigger refuses an edit that fills a field the book holds nowhere",
    );
    damaged.close();

    const db = Database.open(file, schemaDir());
    expect.equal(db.schemaVersion, LATEST_VERSION);

    db.with((conn) => {
      clients.update(conn, 1, {
        fullName: "Rohit Kumar Verma",
        email: "rohit@example.com",
        pan: "abcde1234f",
      });

      const found = (search: string) => clients.list(conn, { search }).total;
      expect.equal(found("Verma"), 1, "the edit the book used to refuse");
      expect.equal(found("ABCDE1234F"), 1);
      expect.equal(found("Bose"), 0, "and the name the index was stuck on went with the rebuild");
      expect.equal(found("Sharma"), 0);
      conn.exec("INSERT INTO clients_fts(clients_fts) VALUES('integrity-check')");
    });
    db.close();
  });
});
