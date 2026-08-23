/**
 * The Windows 7 edition's main process.
 *
 * Four ways in, and the first two are the probe this project started as:
 *
 *   --probe-only      run the gate, print it, exit with the result. What CI uses.
 *   --probe           the gate in a window, for a machine with no console to read.
 *   --capture <file>  save a picture of the interface and exit. Takes an optional
 *                     --route to choose the screen and, in a development build,
 *                     --unlock to open the book first.
 *   (nothing)         the app.
 *
 * The probe stays because it is the evidence: it is what answers whether any of
 * this runs on Windows 7, and it has to keep answering that after every change.
 *
 * `--capture` is the same idea aimed at the screens. Tailwind 4 writes CSS that
 * Chromium 108 cannot parse, the build downlevels it, and whether that worked is a
 * question about pixels — so the app can answer it in a PNG, from the machine in
 * question, without anyone having to describe what they see.
 *
 * Only the last of the four is the app: it takes a tray icon and the single
 * instance lock, and the three diagnostics take neither, so any of them can be run
 * on a machine where the app is already open — usually the machine in question.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { dispatch } from "./core/commands";
import type { Database } from "./core/db";
import { toWire } from "./core/errors";
import * as mail from "./core/mail";
import * as reminders from "./core/reminders";
import * as settings from "./core/repo/settings";
import { Session } from "./core/session";
import * as updates from "./core/updates";
import { electronEnv, trayIconPath } from "./env";
import { runProbe, type ProbeReport } from "./probe";
import {
  closeAction,
  secondLaunchAction,
  startsHidden,
  sweepIsDue,
  SWEEP_TICK_MS,
  trayEffects,
  trayIconPoints,
  trayMenu,
  TRAY_TOOLTIP,
  type TrayItemId,
} from "./shell";

// Windows 7 in a virtual machine usually has no usable GPU driver, and Chromium
// shows a blank window rather than falling back to software rendering by itself.
app.disableHardwareAcceleration();

// A second launch of the app proper gives way to the copy already running, which
// is asked to come forward below. The diagnostics never ask for the lock, so they
// still run beside a live app — which is where they are usually wanted.
const holdsInstanceLock =
  secondLaunchAction(process.argv) === "start" || app.requestSingleInstanceLock();
if (!holdsInstanceLock) app.exit(0);

let report: ProbeReport | undefined;
let session: Session | undefined;
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;

/**
 * Set on the way out so the window's own close handler stops parking the app in
 * the tray and lets it close. Anything that quits goes through `before-quit`,
 * including the tray's own Quit and the relaunch the Settings screen asks for.
 */
let quitting = false;
app.on("before-quit", () => {
  quitting = true;
});

app.on("second-instance", () => showMainWindow());

/** `show_main_window` in `tray.rs`, in the same order for the same reasons. */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

/**
 * What `app.emit` is in the Rust core: something the interface did not ask for and
 * has to be told. `preload.ts` listens on these channel names and
 * `ui/shims/event.ts` hands them to the screens as the `listen()` they already
 * call, so an event sent from here needs nothing added on the other side. The
 * tray's lock sends `session:locked`; a reminder sweep sends `reminders:swept`.
 */
function emitAppEvent(event: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(`app:event:${event}`, payload);
}

/**
 * Plain hyphens and no colour: this has to stay readable in the Windows console,
 * which is not UTF-8 by default.
 */
function printReport(report: ProbeReport): void {
  const lines = ["", "StayInsured Windows 7 probe", ""];

  for (const [name, value] of Object.entries(report.environment)) {
    lines.push(`  ${name}: ${value}`);
  }
  lines.push("");

  for (const check of report.checks) {
    lines.push(`  [${check.ok ? "PASS" : "FAIL"}] ${check.name} - ${check.detail}`);
  }

  const failed = report.checks.filter((check) => !check.ok).length;
  lines.push("", failed === 0 ? "  Gate passed." : `  Gate failed on ${failed} check(s).`, "");
  console.log(lines.join("\n"));
}

function probeWindow(): void {
  const window = new BrowserWindow({
    width: 940,
    height: 760,
    title: "StayInsured — Windows 7 probe",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void window.loadFile(path.join(__dirname, "..", "src", "renderer", "index.html"));
}

function appWindow(route = "/", showWhenReady = true): BrowserWindow {
  const window = new BrowserWindow({
    width: 1_280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "StayInsured",
    // A window that appears before the interface has painted looks like a hang on
    // a slow machine, which is every machine this edition is for.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (showWhenReady) window.once("ready-to-show", () => window.show());

  window.on("close", (event) => {
    if (closeAction({ tray: tray !== undefined, quitting }) === "close") return;
    event.preventDefault();
    window.hide();
  });

  // On the machines this edition is for there is no devtools window worth opening
  // and often no console either, so what the interface says goes to the log beside
  // the database. A blank window with an explanation is debuggable; a blank window
  // is not.
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`the interface failed to load: ${description} (${code}) at ${url}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`the interface stopped: ${details.reason}`);
  });
  window.webContents.on("console-message", (_event, level, message, line, source) => {
    if (level >= 2) console.error(`interface: ${message} (${source}:${line})`);
  });

  // The interface is built by `npm run ui:build` into dist-ui, from the app's own
  // React source with the Tauri modules aliased onto the shims in ui/shims. It
  // routes on the hash, so a screen can be opened directly.
  void window.loadFile(path.join(__dirname, "..", "dist-ui", "index.html"), { hash: route });

  // A link in a policy note belongs in the operator's browser, not in a second
  // window of an app that has no address bar.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  return window;
}

/**
 * The tray is what keeps the app alive after the window is closed, which is how
 * reminders can fire without a visible window.
 *
 * The icon is a template image, which is how a Mac menu bar knows to tint it for a
 * light or a dark bar — `icon_as_template` in `tray.rs`, and ignored elsewhere.
 * The one thing here that cannot be matched is `show_menu_on_left_click(false)`: a
 * Mac status item with a menu attached opens it on any click, so the left click
 * that brings the window up is a Windows behaviour, which is the platform this
 * edition exists for.
 */
function createTray(session: Session): Tray {
  const points = trayIconPoints(process.platform);
  const drawn = nativeImage.createFromPath(trayIconPath());
  const icon = points === null ? drawn : drawn.resize({ width: points, height: points });
  icon.setTemplateImage(true);

  const trayIcon = new Tray(icon);
  trayIcon.setToolTip(TRAY_TOOLTIP);
  trayIcon.setContextMenu(
    Menu.buildFromTemplate(
      trayMenu().map((item) =>
        item.kind === "separator"
          ? { type: "separator" as const }
          : { label: item.label, click: () => runTrayCommand(item.id, session) },
      ),
    ),
  );
  trayIcon.on("click", () => showMainWindow());

  return trayIcon;
}

function runTrayCommand(id: TrayItemId, session: Session): void {
  for (const effect of trayEffects(id)) {
    switch (effect) {
      case "lock":
        // Nothing in the webview asked for this, so it is told. Left alone it
        // would show a book it can no longer read.
        emitAppEvent("session:locked", session.lock());
        break;
      case "show":
        showMainWindow();
        break;
      case "quit":
        // `app.exit(0)` is what the Rust core does here, but this edition closes
        // its database on the way out rather than leaving it to the process
        // ending, so it takes the orderly route through `window-all-closed`.
        app.quit();
        break;
    }
  }
}

/**
 * A sweep already under way. The Rust core's tick is a thread that sleeps between
 * runs and so cannot overlap itself; a timer can, on a slow mail server, so a run
 * in progress skips the tick rather than starting a second sweep beside it.
 */
let sweeping = false;

/**
 * The daily sweep, from `scheduler.rs`.
 *
 * A timer asks once a minute whether today's sweep has already run, rather than
 * waking at the send time, so a machine that was asleep at nine sweeps as soon as
 * it is opened and one that was open all day still sweeps once. `sweepIsDue` in
 * `shell.ts` holds that decision.
 */
function startSweepTimer(session: Session): void {
  setInterval(() => void sweepTick(session), SWEEP_TICK_MS);
}

async function sweepTick(session: Session): Promise<void> {
  if (sweeping) return;

  // Locked means there is nothing to read and nothing to send. The sweep resumes
  // after the next unlock.
  let db: Database;
  try {
    db = session.db();
  } catch {
    return;
  }

  const due = db.with((conn) =>
    sweepIsDue({
      enabled: settings.getOr(conn, "reminders_enabled", "false") === "true",
      sendTime: settings.getOr(conn, "reminder_send_time", "09:00"),
      lastSweepAt: settings.get(conn, "last_sweep_at"),
      now: new Date(),
    }),
  );
  if (!due) return;

  const config = db.with((conn) => mail.load(conn, session.env.secrets));
  let mailer: mail.Mailer | null = null;
  if (mail.isUsable(config)) {
    try {
      mailer = mail.Mailer.connect(config);
    } catch (error) {
      // Unsendable settings are not a reason to skip the sweep: what is due is
      // still worked out and queued, and `dispatch` reports that nothing went.
      console.warn(`the mail server could not be reached: ${describeError(error)}`);
    }
  }

  sweeping = true;
  try {
    const run = await db.with((conn) =>
      reminders.sweep(conn, mailer, reminders.alerts(session.env), reminders.liveOptions()),
    );
    console.log(
      `reminder sweep finished: ${run.queued} queued, ${run.sent} sent, ` +
        `${run.failed} failed, ${run.skipped} skipped`,
    );
    // The reminders screen refreshes itself rather than showing yesterday's
    // numbers until someone reloads it.
    emitAppEvent("reminders:swept", run);
  } catch (error) {
    console.warn(`the reminder sweep could not run: ${describeError(error)}`);
  } finally {
    sweeping = false;
    mailer?.close();
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function registerBridge(window: BrowserWindow, session: Session): void {
  // One channel for all 73 command names. The renderer sends a name; the table in
  // core/commands.ts decides whether it means anything.
  ipcMain.handle("app:invoke", async (_event, command: string, args: Record<string, unknown>) => {
    try {
      return { ok: true, value: await dispatch(session, command, args) };
    } catch (error) {
      // Returned as data rather than thrown: an error thrown across ipcMain.handle
      // reaches the renderer as a string with a prefix, and `src/lib/api.ts` needs
      // the `{ kind, message }` object to rebuild its ApiError.
      return { ok: false, error: toWire(error) };
    }
  });

  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:window-visible", () => window.isVisible());

  ipcMain.handle("app:open-dialog", async (_event, options: Electron.OpenDialogOptions & { multiple?: boolean; directory?: boolean }) => {
    const result = await dialog.showOpenDialog(window, {
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters,
      properties: [
        options.directory ? "openDirectory" : "openFile",
        ...(options.multiple ? (["multiSelections"] as const) : []),
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return options.multiple ? result.filePaths : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("app:save-dialog", async (_event, options: Electron.SaveDialogOptions) => {
    const result = await dialog.showSaveDialog(window, {
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters,
    });
    return result.canceled ? null : (result.filePath ?? null);
  });

  ipcMain.handle(
    "app:ask",
    async (
      _event,
      message: string,
      options: { title?: string; kind?: "info" | "warning" | "error"; okLabel?: string; cancelLabel?: string },
    ) => {
      const result = await dialog.showMessageBox(window, {
        type: options.kind ?? "question",
        title: options.title,
        message,
        buttons: [options.okLabel ?? "Yes", options.cancelLabel ?? "No"],
        defaultId: 0,
        cancelId: 1,
      });
      return result.response === 0;
    },
  );

  ipcMain.handle("app:autostart", (_event, action: "status" | "enable" | "disable") => {
    if (action === "status") return app.getLoginItemSettings().openAtLogin;
    // `--background` is the argument the Rust core's autostart plugin registers
    // with, and the reason a login does not put a window in front of someone who
    // was logging in rather than opening the app.
    app.setLoginItemSettings({ openAtLogin: action === "enable", args: ["--background"] });
    return undefined;
  });

  ipcMain.handle("app:relaunch", () => {
    app.relaunch();
    app.quit();
  });

  // Not in the command table above, and deliberately: that table is held name for
  // name against the Rust core's `generate_handler!`, and the app's edition has no
  // commands for this because Tauri's updater plugin does it. These sit beside
  // `app:version` for the same reason it does.
  ipcMain.handle("app:update-check", async () => {
    // Windows only. Nothing signs the Mac builds, they exist so a packaging
    // mistake shows up without a virtual machine, and Gatekeeper would refuse a
    // copy replaced behind its back.
    if (process.platform !== "win32") return null;

    try {
      const found = await updates.check(app.getVersion());
      return found === null ? null : { version: found.version };
    } catch (error) {
      // An update check is never the reason to interrupt somebody's morning. A
      // missing network, a rate-limited API or a release whose manifest does not
      // verify all mean the same thing to the person at the desk: nothing to
      // install. The reason is written down for whoever reads the log.
      console.warn("update check failed:", describeError(error));
      return null;
    }
  });

  // Split from the check so the interface can ask before spending 137 MB of
  // somebody's connection, which is what the shared update dialog does.
  ipcMain.handle("app:update-install", async () => {
    const found = await updates.check(app.getVersion());
    if (found === null) throw new Error("There is no update to install.");

    const installer = await updates.download(found);

    // The wizard is left visible rather than run silently. This edition is
    // installed by hand today, so the window that appears is the one its owner
    // already knows; a silent install that failed would leave a machine with a
    // closed app and nothing said. `--force-run` is electron-builder's own
    // argument for launching the app afterwards, and is ignored if unrecognised.
    spawn(installer, ["--force-run"], { detached: true, stdio: "ignore" }).unref();

    // Windows cannot replace the files of a running application, so this is the
    // last thing the app does.
    setTimeout(() => app.quit(), 1_000);
  });
}

app.whenReady().then(async () => {
  // The process is already on its way out when the lock was not ours, and Electron
  // can reach this before it goes.
  if (!holdsInstanceLock) return;

  const probeOnly = process.argv.includes("--probe-only");
  const probeInWindow = process.argv.includes("--probe");

  if (probeOnly || probeInWindow) {
    try {
      report = runProbe();
    } catch (error) {
      report = {
        environment: { electron: process.versions.electron, chrome: process.versions.chrome },
        checks: [
          {
            name: "the probe itself ran",
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
          },
        ],
        reportPath: "",
      };
    }

    printReport(report);

    if (probeOnly) {
      app.exit(report.checks.every((check) => check.ok) ? 0 : 1);
      return;
    }

    ipcMain.handle("probe:report", () => report);
    probeWindow();
    return;
  }

  // A failure here is a failure to open the book at all, so it gets a dialog
  // rather than a stack trace nobody will see.
  try {
    session = new Session(electronEnv());
  } catch (error) {
    dialog.showErrorBox(
      "StayInsured could not start",
      `${error instanceof Error ? error.message : String(error)}\n\n` +
        "Run the installed app with --probe to see what failed.",
    );
    app.exit(1);
    return;
  }

  const capture = captureRequest(process.argv);

  // Opened before the window rather than typed into it, so the interface asks for
  // the session state once and gets the answer it will keep. Reloading a mounted
  // interface to change its mind is a second thing to go wrong in a diagnostic.
  if (capture?.password) {
    try {
      await session.unlock(capture.password);
    } catch (error) {
      console.error(`could not open the book: ${error instanceof Error ? error.message : String(error)}`);
      app.exit(1);
      return;
    }
  }

  // `--background` and a capture do not mix: the capture has a picture to take and
  // needs a painted window to take it from.
  const hidden = capture === null && startsHidden(process.argv);

  const window = appWindow(capture?.route ?? "/", !hidden);
  mainWindow = window;
  registerBridge(window, session);

  // The capture takes its picture and exits, so it gets neither a tray nor the
  // sweep: an icon that appears for a second and a half, and a window that then
  // refuses to close, are both the wrong shape for a diagnostic — and a diagnostic
  // that photographs a screen has no business writing to an agency's clients on
  // the way past.
  if (!capture) {
    tray = createTray(session);
    startSweepTimer(session);
  }

  if (capture) {
    // A second and a half of settling after first paint: the interface asks for the
    // session state and its data as it mounts, and a picture taken before those
    // answers arrive shows spinners rather than a screen.
    window.once("ready-to-show", () => {
      setTimeout(() => {
        void window.webContents
          .capturePage()
          .then((image) => {
            fs.writeFileSync(capture.file, image.toPNG());
            console.log(`Saved a picture of the interface to ${capture.file}`);
            app.exit(0);
          })
          .catch((error: unknown) => {
            console.error(`could not capture the interface: ${String(error)}`);
            app.exit(1);
          });
      }, 1_500);
    });
  }
});

interface CaptureRequest {
  file: string;
  /** A route in the interface's hash router, so any screen can be photographed. */
  route: string;
  /** Opens the book first, for the screens that are behind the lock. */
  password: string | null;
}

function valueAfter(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  const value = argv[index + 1];
  return !value || value.startsWith("--") ? null : value;
}

function captureRequest(argv: string[]): CaptureRequest | null {
  if (!argv.includes("--capture")) return null;

  const file = valueAfter(argv, "--capture");
  if (!file) {
    console.error("--capture needs a file to write to");
    app.exit(1);
    return null;
  }

  // A packaged build has no business taking a password off a command line. It
  // would grant nothing — this edition's database is unencrypted, so anyone able
  // to pass the flag can already read the file — but a shipped app that types its
  // own password is not a thing to leave lying around.
  const password = app.isPackaged ? null : valueAfter(argv, "--unlock");

  return { file: path.resolve(file), route: valueAfter(argv, "--route") ?? "/", password };
}

app.on("window-all-closed", () => {
  session?.lock();
  app.quit();
});
