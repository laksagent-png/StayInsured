import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";

import { runProbe, type ProbeReport } from "./probe";

// Windows 7 in a virtual machine usually has no usable GPU driver, and Chromium
// shows a blank window rather than falling back to software rendering by itself.
// The probe has to be readable on exactly those machines.
app.disableHardwareAcceleration();

let report: ProbeReport | undefined;

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

function createWindow(): void {
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

app.whenReady().then(() => {
  // Run before the window exists so a database failure still has somewhere to
  // be displayed, rather than taking the app down on startup.
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

  // `--probe-only` lets a build machine run the gate without a window and fail
  // the job on a bad result. It cannot answer the Windows 7 question, since no
  // runner is that old, but it catches a broken schema or an unloadable module
  // before anyone carries an installer to a virtual machine.
  if (process.argv.includes("--probe-only")) {
    app.exit(report.checks.every((check) => check.ok) ? 0 : 1);
    return;
  }

  ipcMain.handle("probe:report", () => report);
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
