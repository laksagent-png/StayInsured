/**
 * The entry point for `npm test`, which runs under Electron's Node rather than the
 * machine's — see the note in `harness.ts` for why it has to.
 *
 * Registration is by import: each test file calls `suite`/`test` at module scope,
 * so importing it registers its cases and the order here is the order they run.
 */

import { runAll } from "./harness";
import { cleanUp, schemaDir } from "./support";

import fs from "node:fs";

import "./util.test";
import "./query.test";
import "./session.test";
import "./clients.test";
import "./policies.test";

async function main(): Promise<void> {
  // The schema belongs to the Rust core and is read from its tree. Missing, every
  // database test fails at `Database.open` with something about SQL, which is a
  // long way from "you are running this from the wrong place".
  if (!fs.existsSync(schemaDir())) {
    console.error(`\n  Cannot find the schema at ${schemaDir()}\n`);
    process.exit(1);
  }

  console.log("\nStayInsured Windows 7 edition — core tests");
  console.log(`  node ${process.versions.node}, sqlite via better-sqlite3, plain unencrypted file`);

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
