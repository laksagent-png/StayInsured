/**
 * The tray and the window, as far as they can be held to the Rust core here.
 *
 * There is no `Tray` to build and no window to close under
 * `ELECTRON_RUN_AS_NODE`, so what these check is `src/shell.ts`: the wording an
 * operator reads in the menu, the order the lock item does its two jobs in, which
 * launches give way to the copy already running, whether a close ends the app, and
 * when the day's reminder sweep is due. Each is a question `tray.rs`, `lib.rs` and
 * `scheduler.rs` already answer, and each is a place the two editions could
 * disagree without anything failing.
 *
 * The part left untested is the wiring in `main.ts`, which is why it is kept to
 * naming these answers and doing what they say.
 */

import {
  closeAction,
  isDiagnosticLaunch,
  parseSendTime,
  secondLaunchAction,
  startsHidden,
  sweepIsDue,
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

suite("the daily tick", () => {
  const at = (hour: number, minute: number) => new Date(2027, 2, 31, hour, minute, 0);
  const due = (over: Partial<Parameters<typeof sweepIsDue>[0]>) =>
    sweepIsDue({
      enabled: true,
      sendTime: "09:00",
      lastSweepAt: null,
      now: at(9, 30),
      ...over,
    });

  test("does nothing while automatic sending is switched off", () => {
    expect.ok(!due({ enabled: false }));
  });

  test("waits for the send time to pass", () => {
    expect.ok(!due({ now: at(8, 59) }));
    expect.ok(due({ now: at(9, 0) }), "the send time itself counts as passed");
  });

  test("sweeps once a day, however long the app stays open", () => {
    expect.ok(!due({ lastSweepAt: "2027-03-31T09:00:04+05:30" }));
  });

  test("catches up on the day it is opened rather than skipping it", () => {
    expect.ok(
      due({ lastSweepAt: "2027-03-24T09:00:04+05:30" }),
      "a machine that was off for a week sweeps as soon as it comes back",
    );
  });

  test("falls back to nine when the send time cannot be read", () => {
    expect.equal(parseSendTime("09:00"), 9 * 3_600);
    expect.equal(parseSendTime(" 18:30:15 "), 18 * 3_600 + 30 * 60 + 15);
    expect.equal(parseSendTime("half past six"), 9 * 3_600);
    expect.equal(parseSendTime("25:00"), 9 * 3_600);
  });
});
