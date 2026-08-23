#!/usr/bin/env node
/**
 * Makes the keypair that signs this edition's updates.
 *
 *   node scripts/update-keygen.js
 *
 * The private half is written outside the repository and never printed, because a
 * key that has been on a screen has been in a scrollback. Put its contents in the
 * repository secret named below; the public half goes in `src/core/updates.ts`,
 * where the app reads it to decide whether an installer it just downloaded was
 * built by this project.
 *
 * Run this only to create the first key or to replace a key that leaked. Replacing
 * it means every installed copy stops accepting updates until it has been updated
 * by hand, since the copy already out there is holding the old public key.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SECRET = "LEGACY_UPDATE_SIGNING_KEY";
const dir = path.join(os.homedir(), ".stayinsured");
const file = path.join(dir, "legacy-update.key");

if (fs.existsSync(file) && !process.argv.includes("--force")) {
  console.error(`${file} already exists. Pass --force to replace it, and read the warning above first.`);
  process.exit(1);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");

fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });

const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");

console.log(`Private key written to ${file} (mode 600), and not shown here.`);
console.log("");
console.log(`Add it as the repository secret ${SECRET}:`);
console.log(`  gh secret set ${SECRET} < ${file}`);
console.log("  or paste the file's contents into Settings, Secrets and variables, Actions.");
console.log("");
console.log("Public key, for RELEASE_PUBLIC_KEY in src/core/updates.ts:");
console.log(`  ${pub}`);
