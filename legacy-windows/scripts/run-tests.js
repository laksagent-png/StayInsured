/**
 * Runs the core tests under Electron's Node.
 *
 * `better-sqlite3` here is built against Electron 22's ABI, so the machine's own
 * `node` cannot load it. `ELECTRON_RUN_AS_NODE=1` turns the Electron binary into
 * that Node: same ABI, no Electron APIs, and — the reason this is not simply an
 * inline environment variable in the npm script — a console application, so the
 * output reaches a Windows terminal and a CI log rather than disappearing into a
 * GUI process with nothing attached to its stdout.
 *
 * Plain JavaScript because it has to run before `tsc` has done anything.
 */

const { spawn } = require("node:child_process");
const path = require("node:path");

const electron = require("electron");
const entry = path.join(__dirname, "..", "out", "tests", "run.js");

const child = spawn(electron, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});

child.on("close", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error(`could not start Electron: ${error.message}`);
  process.exit(1);
});
