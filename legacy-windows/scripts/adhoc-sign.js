/**
 * Signs the Mac build with no certificate, so a copy that will not open says why.
 *
 * There is no signing identity on the runner and there is not going to be one:
 * these disk images exist so the packaged app can be run on a machine we already
 * have, not for anyone to install. electron-builder's answer to a missing identity
 * is to sign nothing — "skipped macOS application code signing" — which leaves the
 * bundle carrying only the signature the linker put on the executable, with its
 * resources unsealed.
 *
 * macOS reads that particular combination — quarantined, and a bundle signature
 * that does not validate — as a corrupted download: *"is damaged and can't be
 * opened. You should move it to the Bin."* Nothing is damaged, the file is exactly
 * the one that was built, and moving it to the Bin is the one instruction on offer.
 * Right-click and Open does not rescue it either, so the message is a dead end.
 *
 * An ad-hoc signature needs no certificate, no Apple account and nothing kept
 * secret. It seals the bundle, so the same download instead gets the ordinary
 * unnotarised dialog — Apple cannot check it for malicious software — which has an
 * Open Anyway beside it in Privacy and Security. Clearing the quarantine flag by
 * hand is still quicker, and the READMEs still say how, but the fallback is now a
 * door rather than a wall.
 *
 * This buys no trust: an ad-hoc signature says only that the bundle has not been
 * altered since it was signed, and anyone can make one. What vouches for a Windows
 * build is the release key in `src/core/updates.ts`, which is a different question
 * with a different answer.
 */

const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  // A real identity means electron-builder has already signed it properly, and
  // replacing that with an ad-hoc signature would throw away the only signature
  // worth having.
  if (context.packager.platformSpecificBuildOptions.identity) return;

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  // Bottom-up through the helpers and frameworks, which each carry their own
  // signature; the outer bundle cannot seal until they are done. `--force`
  // replaces what the linker left behind.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });

  // Verifying here rather than trusting the exit code: the failure this exists to
  // prevent is a signature that is present but does not validate, which is what
  // was being shipped.
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });

  console.log(`  • ad-hoc signed and verified ${path.basename(app)}`);
};
