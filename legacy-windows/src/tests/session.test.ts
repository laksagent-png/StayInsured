/**
 * The password wall, which in this edition is the only wall.
 *
 * The Rust core derives the SQLCipher key from the password, so a wrong password
 * cannot open the file at all — `wrong_password_is_rejected` asserts that at the
 * database level. Here the file opens regardless and the Argon2 hash in `users` is
 * what refuses, so these tests do the job that encryption was doing: prove that a
 * wrong password is turned away, that the password is never stored in a form that
 * could be read back, and that the schema is the same one the Rust core writes.
 *
 * What no test here can claim is that the data is protected from someone holding
 * the file. It is not. That is the trade, and `state().encrypted` is false so the
 * interface says so.
 */

import fs from "node:fs";

import { LATEST_VERSION } from "../core/schema";
import * as settings from "../core/repo/settings";
import { Session } from "../core/session";
import { expect, suite, test, throwsKind } from "./harness";
import { scalar, tempEnv, unlockedSession } from "./support";

suite("first run", () => {
  test("writes the owner, the schema and the seeded settings", async () => {
    const { session } = await unlockedSession("setup");
    const state = session.state();

    expect.ok(state.initialised);
    expect.ok(state.unlocked);
    expect.equal(state.schemaVersion, LATEST_VERSION);
    expect.equal(
      state.encrypted,
      false,
      "the interface promises encryption only where there is some, and here there is none",
    );

    session.db().with((conn) => {
      expect.equal(scalar<number>(conn, "PRAGMA user_version"), LATEST_VERSION);
      expect.ok(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM insurers") > 20,
        "the seeded insurers are there, so the pickers are not empty on a new book",
      );
      expect.equal(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM reminder_rules WHERE is_active = 1"),
        5,
        "the 60/30/15/7/1 ladder is active, as in the Rust core",
      );
      expect.equal(settings.get(conn, "currency"), "INR");
      expect.equal(
        settings.get(conn, "provider_name"),
        "Sunrise Insurance Services",
        "the agency name from the setup screen reaches the settings the emails read",
      );
    });
  });

  test("refuses a password too short to be worth having", async () => {
    const session = new Session(tempEnv("short-password"));
    await throwsKind("validation", () => session.setup("short12"));
    expect.ok(!session.state().initialised, "and nothing is left half set up");
  });

  test("happens once", async () => {
    const { session } = await unlockedSession("twice");
    await throwsKind("already_initialised", () => session.setup("another password entirely"));
  });

  test("keeps no copy of the password anywhere in the file", async () => {
    const { session, env } = await unlockedSession("no-plaintext");
    session.lock();

    const raw = fs.readFileSync(env.paths.database);
    expect.equal(
      raw.includes(Buffer.from("correct horse battery")),
      false,
      "the file is readable by anyone, so the one thing it must not contain is the password",
    );
  });
});

suite("unlocking", () => {
  test("turns away a wrong password", async () => {
    const { session } = await unlockedSession("wrong-password");
    session.lock();

    await throwsKind("bad_password", () => session.unlock("the wrong one"));
    expect.ok(!session.state().unlocked);

    await session.unlock("correct horse battery");
    expect.ok(session.state().unlocked);
  });

  test("refuses every command that touches data while locked", async () => {
    const { session } = await unlockedSession("locked-guard");
    session.lock();

    await throwsKind(
      "locked",
      () => session.db(),
      "which is what sends the interface back to its lock screen",
    );
  });

  test("brings the statuses up to date on the way in", async () => {
    const { session } = await unlockedSession("unlock-sweep");

    // A policy that expired while the app was closed.
    session.db().with((conn) => {
      conn
        .prepare("INSERT INTO clients (client_code, full_name) VALUES ('CL-00001', 'Ravi Kumar')")
        .run();
      conn.prepare("INSERT INTO insurers (name) VALUES ('Test Insurer')").run();
      conn
        .prepare(
          "INSERT INTO policies (chain_id, policy_year, policy_number, client_id, insurer_id, " +
            "category, status, start_date, expiry_date) VALUES ('chain-1', 1, 'SW-1', " +
            "(SELECT id FROM clients LIMIT 1), (SELECT id FROM insurers WHERE name = 'Test Insurer'), " +
            "'health', 'active', date('now', '-370 days'), date('now', '-5 days'))",
        )
        .run();
    });

    session.lock();
    await session.unlock("correct horse battery");

    expect.equal(
      session.db().with((conn) => scalar<string>(conn, "SELECT status FROM policies WHERE policy_number = 'SW-1'")),
      "expired",
      "so the desk is right the moment it is opened, without waiting for a sweep",
    );
  });

  test("does not leave the book open after a lock", async () => {
    const { session } = await unlockedSession("lock");
    const state = session.lock();

    expect.ok(!state.unlocked);
    expect.ok(state.initialised, "locking is not forgetting");
  });
});

suite("trusting a device", () => {
  test("remembers only when asked", async () => {
    const env = tempEnv("remember");
    const session = new Session(env);

    await session.setup("correct horse battery", "Sunrise", false);
    expect.ok(!session.state().canUseKeychain);
    await throwsKind("locked", () => session.unlockWithKeychain());

    session.lock();
    await session.unlock("correct horse battery", true);
    expect.ok(session.state().canUseKeychain);

    session.lock();
    expect.ok(session.unlockWithKeychain().unlocked, "and then opens without the password");
  });

  test("forgets when told to, and asks again", async () => {
    const env = tempEnv("forget");
    const session = new Session(env);
    await session.setup("correct horse battery", "Sunrise", true);

    expect.ok(env.secrets.read("device") !== null);
    session.forgetDevice();
    expect.equal(env.secrets.read("device"), null);

    session.lock();
    await throwsKind("locked", () => session.unlockWithKeychain());
  });
});

suite("changing the password", () => {
  test("leaves the book readable with the new one and not the old", async () => {
    const { session } = await unlockedSession("change-password");

    await session.changePassword("correct horse battery", "a different long password");
    session.lock();

    await throwsKind("bad_password", () => session.unlock("correct horse battery"));
    await session.unlock("a different long password");
    expect.ok(session.state().unlocked);
  });

  test("needs the current one, and a new one worth having", async () => {
    const { session } = await unlockedSession("change-guard");

    await throwsKind("bad_password", () => session.changePassword("not it", "a different long password"));
    await throwsKind("validation", () => session.changePassword("correct horse battery", "short12"));

    session.lock();
    await session.unlock("correct horse battery");
    expect.ok(session.state().unlocked, "and the old password still works after a refusal");
  });

  test("leaves a trusted device trusted", async () => {
    const env = tempEnv("change-trusted");
    const session = new Session(env);
    await session.setup("correct horse battery", "Sunrise", true);

    await session.changePassword("correct horse battery", "a different long password");

    // The Rust core has to rewrite the stored key here because the key changed with
    // the password. There is no key in this edition, so there is nothing to rewrite
    // — and nothing that should have been.
    expect.ok(session.state().canUseKeychain);
    session.lock();
    expect.ok(session.unlockWithKeychain().unlocked);
  });
});
