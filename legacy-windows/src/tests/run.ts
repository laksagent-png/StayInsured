/**
 * The entry point for `npm test`, which runs under Electron's Node rather than the
 * machine's — see the note in `harness.ts` for why it has to.
 *
 * Registration is by import: each file calls `suite`/`test` at module scope, so
 * requiring it registers its cases. They are discovered from the directory rather
 * than listed here, because a list is a line every new test file has to add to the
 * same place — which is a merge conflict in any work split across more than one
 * pair of hands, and a test file silently not running if anyone forgets.
 */

import { runAll } from "./harness";
import { cleanUp, schemaDir } from "./support";

import fs from "node:fs";
import path from "node:path";

/** Alphabetical, so a failure is in the same place on every machine. */
function loadTestFiles(): string[] {
  const files = fs
    .readdirSync(__dirname)
    .filter((name) => name.endsWith(".test.js"))
    .sort();

  for (const name of files) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(path.join(__dirname, name));
  }
  return files;
}

async function main(): Promise<void> {
  // The schema belongs to the Rust core and is read from its tree. Missing, every
  // database test fails at `Database.open` with something about SQL, which is a
  // long way from "you are running this from the wrong place".
  if (!fs.existsSync(schemaDir())) {
    console.error(`\n  Cannot find the schema at ${schemaDir()}\n`);
    process.exit(1);
  }

  const files = loadTestFiles();

  console.log("\nStayInsured Windows 7 edition — core tests");
  console.log(`  node ${process.versions.node}, sqlite via better-sqlite3, plain unencrypted file`);
  console.log(`  ${files.length} test files`);

  const started = Date.now();
  const { passed, failed } = await runAll();
  cleanUp();

  const seconds = ((Date.now() - started) / 1_000).toFixed(1);
  console.log(`\n  ${passed} passed, ${failed} failed in ${seconds}s\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error(error);
  cleanUp();
  process.exit(1);
});
