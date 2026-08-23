#!/usr/bin/env node
/**
 * Writes the `latest.json` an installed copy reads to decide whether to update.
 *
 *   node scripts/update-manifest.js dist/StayInsured-Win7-Probe-0.0.7.exe
 *
 * Run in CI after the installer is built, with the private key in
 * `LEGACY_UPDATE_SIGNING_KEY`. The manifest is published as a release asset beside
 * the installer, and `core/updates.ts` refuses anything whose signature does not
 * check out against the public key compiled into the app.
 *
 * The signed string comes from the app's own `signedText`, imported from the build
 * rather than repeated here, so what CI signs cannot drift from what the app
 * verifies. A drift like that would look exactly like a break-in.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { signedText } = require(path.join(__dirname, "..", "out", "core", "updates.js"));

const installer = process.argv[2];
if (!installer) {
  console.error("Usage: node scripts/update-manifest.js <installer>");
  process.exit(1);
}

const pem = process.env.LEGACY_UPDATE_SIGNING_KEY;
if (!pem) {
  console.error("LEGACY_UPDATE_SIGNING_KEY is not set, so this release could not be signed.");
  console.error("");
  console.error("Every installed copy checks that signature before it will accept an update, so");
  console.error("publishing without it means a release nobody can upgrade to. Add the secret —");
  console.error("`node scripts/update-keygen.js` makes the key — and tag again.");
  process.exit(1);
}

const version = require(path.join(__dirname, "..", "package.json")).version;
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(installer)).digest("hex");

const signature = crypto
  .sign(null, Buffer.from(signedText(version, sha256), "utf8"), crypto.createPrivateKey(pem))
  .toString("base64");

const manifest = {
  version,
  installer: path.basename(installer),
  sha256,
  signature,
};

const out = path.join(path.dirname(installer), "latest.json");
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`${out} describes ${manifest.installer}`);
console.log(`  version   ${version}`);
console.log(`  sha256    ${sha256}`);
console.log(`  signature ${signature.slice(0, 16)}… (${signature.length} chars)`);
