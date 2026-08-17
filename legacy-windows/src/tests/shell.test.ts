/**
 * The tray and the window, as far as they can be held to the Rust core here.
 *
 * There is no `Tray` to build and no window to close under
 * `ELECTRON_RUN_AS_NODE`, so what these check is `src/shell.ts`: the wording an
 * operator reads in the menu, the order the lock item does its two jobs in, which
 * launches give way to the copy already running, and whether a close ends the app.
 * Each is a question `tray.rs` and `lib.rs` already answer, and each is a place the
 * two editions could disagree without anything failing.
 *
 * The part left untested is the wiring in `main.ts`, which is why it is kept to
 * naming these answers and doing what they say.
 */

import {
  closeAction,
  isDiagnosticLaunch,
  secondLaunchAction,
  startsHidden,
  trayEffects,
  trayIconPoints,
  trayMenu,
  TRAY_TOOLTIP,
} from "../shell";
import { expect, suite, test } from "./harness";

suite("the tray menu", () => {
  test("offers Open, Lock now and Quit, in that order and those words", () => {
    // `tray.rs`, and the table in docs/guide/install-and-first-run.md, which is
    // where an operator is told what these items are called.
    expect.deepEqual(trayMenu(), [
      { kind: "command", id: "open", label: "Open StayInsured" },
      { kind: "command", id: "lock", label: "Lock now" },
      { kind: "separator" },
      { kind: "command", id: "quit", label: "Quit StayInsured" },
    ]);
    expect.equal(TRAY_TOOLTIP, "StayInsured");
  });

  test("closes the book before showing the window, not after", () => {
    expect.deepEqual(
      trayEffects("lock"),
      ["lock", "show"],
      "so the window arrives on the lock screen rather than on a book being taken away",
    );
  });

  test("opens the window without touching the session", () => {
    expect.deepEqual(trayEffects("open"), ["show"]);
  });

  test("quits, and does nothing else on the way", () => {
    expect.deepEqual(trayEffects("quit"), ["quit"]);
  });

  test("brings the app's icon down to the size a Mac menu bar draws at", () => {
    expect.equal(trayIconPoints("darwin"), 16);
    expect.equal(
      trayIconPoints("win32"),
      null,
      "the notification area scales the icon itself, so 32 pixels is left as it is",
    );
    expect.equal(trayIconPoints("linux"), null);
  });
});

suite("a second launch", () => {
  test("hands over to the copy already running", () => {
    expect.equal(
      secondLaunchAction(["electron", "."]),
      "focus-running-instance",
      "two copies on one database file is a book kept in two places",
    );
  });

  test("lets the diagnostics run beside a live app", () => {
    for (const flag of ["--probe", "--probe-only", "--capture"]) {
      expect.ok(isDiagnosticLaunch(["electron", ".", flag]), `${flag} is a diagnostic`);
      expect.equal(
        secondLaunchAction(["electron", ".", flag]),
        "start",
        `${flag} is asked on machines where the app is open, often because it is`,
      );
    }
  });

  test("reads the flag wherever it appears, and is not fooled by a value", () => {
    expect.equal(
      secondLaunchAction(["electron", ".", "--capture", "/tmp/si.png", "--route", "/settings"]),
      "start",
    );
    expect.equal(
      secondLaunchAction(["electron", ".", "--user-data-dir=/tmp/scratch"]),
      "focus-running-instance",
    );
    expect.ok(
      !isDiagnosticLaunch(["electron", ".", "--route", "--probe-only-ish"]),
      "a flag is a whole argument, so nothing that merely contains one counts",
    );
  });
});

suite("starting at login", () => {
  test("goes to the tray when the OS started it, and to the screen otherwise", () => {
    expect.ok(startsHidden(["electron", ".", "--background"]));
    expect.ok(!startsHidden(["electron", "."]));
  });
});

suite("closing the window", () => {
  test("parks the app in the tray rather than ending it", () => {
    expect.equal(
      closeAction({ tray: true, quitting: false }),
      "hide",
      "which is what keeps a scheduled sweep able to run",
    );
  });

  test("closes for real once something has decided to quit", () => {
    expect.equal(
      closeAction({ tray: true, quitting: true }),
      "close",
      "an app whose window refuses to close on the way out cannot be quit",
    );
  });

  test("closes when there is no tray to bring the window back from", () => {
    expect.equal(closeAction({ tray: false, quitting: false }), "close");
  });
});
