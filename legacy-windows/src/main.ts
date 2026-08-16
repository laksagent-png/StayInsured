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
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

import { dispatch } from "./core/commands";
import { toWire } from "./core/errors";
import { Session } from "./core/session";
import { electronEnv } from "./env";
import { runProbe, type ProbeReport } from "./probe";

// Windows 7 in a virtual machine usually has no usable GPU driver, and Chromium
// shows a blank window rather than falling back to software rendering by itself.
app.disableHardwareAcceleration();

let report: ProbeReport | undefined;
let session: Session | undefined;

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

function appWindow(route = "/"): BrowserWindow {
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

  window.once("ready-to-show", () => window.show());

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
    app.setLoginItemSettings({ openAtLogin: action === "enable" });
    return undefined;
  });

  ipcMain.handle("app:relaunch", () => {
    app.relaunch();
    app.quit();
  });
}

app.whenReady().then(async () => {
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

  const window = appWindow(capture?.route ?? "/");
  registerBridge(window, session);

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
