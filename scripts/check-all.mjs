/**
 * Runs every check this repository has, three at a time instead of one.
 *
 * `npm run check` is a chain of `&&`, so the frontend waits on nothing and the
 * edition is never checked at all. The three suites touch different tools and
 * different build directories — cargo in `src-tauri/target`, vitest in memory,
 * `tsc -p .` in `legacy-windows/out` — so nothing is gained by making them queue.
 * Running them together costs the slowest lane rather than the sum of all three.
 *
 * Output is held until a lane finishes, so three suites writing at once still
 * read as three reports. Run it with `npm run check:all`, or name lanes to run
 * a subset: `node scripts/check-all.mjs rust edition`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** npm is a batch file on Windows and is not executable without its extension. */
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const LANES = [
  {
    name: "interface",
    covers: "src/ — types and the screens",
    cwd: root,
    steps: [
      [npm, ["run", "typecheck"]],
      [npm, ["run", "test"]],
    ],
  },
  {
    name: "rust",
    covers: "src-tauri/ — formatting, lints and the data layer",
    cwd: path.join(root, "src-tauri"),
    steps: [
      ["cargo", ["fmt", "--check"]],
      ["cargo", ["clippy", "--all-targets", "--", "-D", "warnings"]],
      ["cargo", ["test", "--lib"]],
    ],
  },
  {
    name: "edition",
    covers: "legacy-windows/ — the ported core, and parity with lib.rs",
    cwd: path.join(root, "legacy-windows"),
    steps: [[npm, ["test"]]],
    // Installed separately from the root, and absent on a machine that has never
    // built the edition. Skipping keeps this usable as a pre-push hook there.
    skipUnless: () => existsSync(path.join(root, "legacy-windows", "node_modules")),
    skipBecause: "legacy-windows/node_modules is missing — run `cd legacy-windows && npm ci`",
  },
];

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => resolve({ code: 1, output: `${output}${error.message}\n` }));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function runLane(lane) {
  const started = Date.now();

  if (lane.skipUnless && !lane.skipUnless()) {
    return { lane, status: "skipped", detail: lane.skipBecause, output: "", seconds: 0 };
  }

  for (const [command, args] of lane.steps) {
    const { code, output } = await run(command, args, lane.cwd);
    if (code !== 0) {
      return {
        lane,
        status: "failed",
        detail: `${command} ${args.join(" ")}`,
        output,
        seconds: (Date.now() - started) / 1000,
      };
    }
  }

  return { lane, status: "passed", detail: "", output: "", seconds: (Date.now() - started) / 1000 };
}

const wanted = process.argv.slice(2);
const unknown = wanted.filter((name) => !LANES.some((lane) => lane.name === name));
if (unknown.length > 0) {
  console.error(`no such lane: ${unknown.join(", ")}`);
  console.error(`lanes are ${LANES.map((lane) => lane.name).join(", ")}`);
  process.exit(1);
}

const lanes = wanted.length > 0 ? LANES.filter((lane) => wanted.includes(lane.name)) : LANES;

console.log(`Checking ${lanes.length} lanes at once.`);
for (const lane of lanes) console.log(`  ${lane.name.padEnd(10)} ${lane.covers}`);
console.log("");

const started = Date.now();
const results = await Promise.all(lanes.map(runLane));
const wall = (Date.now() - started) / 1000;

for (const result of results.filter((result) => result.status === "failed")) {
  console.log(`--- ${result.lane.name}: ${result.detail} ---`);
  console.log(result.output.trimEnd());
  console.log("");
}

const mark = { passed: "ok", failed: "FAILED", skipped: "skipped" };
for (const result of results) {
  const time = result.status === "skipped" ? "" : `${result.seconds.toFixed(1)}s`;
  const why = result.status === "skipped" ? ` — ${result.detail}` : "";
  console.log(`${mark[result.status].padEnd(8)} ${result.lane.name.padEnd(10)} ${time}${why}`);
}

const slowest = Math.max(...results.map((result) => result.seconds), 0);
const serial = results.reduce((total, result) => total + result.seconds, 0);
console.log(
  `\n${wall.toFixed(1)}s, against ${serial.toFixed(1)}s one after another` +
    ` (the ${results.find((result) => result.seconds === slowest)?.lane.name} lane sets the floor).`,
);

process.exit(results.some((result) => result.status === "failed") ? 1 : 0);
