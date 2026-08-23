/**
 * The update channel, which is the one part of this edition with no counterpart in
 * the Rust core to be held against: Tauri's updater plugin does this, so there is
 * no `src-tauri` file that says what it should do. These cases are what says it.
 *
 * Two of them matter more than the rest. A release of the app itself must never be
 * offered to a machine running this edition, because the app's installer refuses
 * Windows 7 by design — that is the whole reason the release is chosen by tag prefix
 * here instead of by `electron-updater`. And a manifest that is not signed by this
 * project's key must not be an update, because nothing else in the chain proves
 * where an installer came from.
 */

import crypto from "node:crypto";
import fs from "node:fs";

import { expect, suite, test } from "./harness";
import {
  check,
  compareVersions,
  download,
  newestRelease,
  signedText,
  verifyManifest,
  type Manifest,
  type ReleaseInfo,
} from "../core/updates";

/** A key that is not the release key, so the tests never need the real one. */
const keys = crypto.generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");

function sign(version: string, sha256: string): string {
  return crypto
    .sign(null, Buffer.from(signedText(version, sha256), "utf8"), keys.privateKey)
    .toString("base64");
}

function release(tag: string, assets: string[] = ["latest.json"]): ReleaseInfo {
  return {
    tag_name: tag,
    assets: assets.map((name) => ({
      name,
      browser_download_url: `https://example.invalid/${tag}/${name}`,
    })),
  };
}

suite("choosing a release", () => {
  test("reads three numbers and nothing else", () => {
    expect.equal(compareVersions("0.0.7", "0.0.6"), 1);
    expect.equal(compareVersions("0.0.6", "0.0.7"), -1);
    expect.equal(compareVersions("0.0.6", "0.0.6"), 0);
    expect.equal(compareVersions("0.1.0", "0.0.99"), 1);
    expect.equal(compareVersions("1.0.0", "0.99.99"), 1);
    expect.equal(compareVersions("0.0.7-rc1", "0.0.7"), 0, "a suffix is not a version of its own");
  });

  test("takes the newest of this edition's own", () => {
    const found = newestRelease(
      [release("legacy-v0.0.7"), release("legacy-v0.0.9"), release("legacy-v0.0.8")],
      "0.0.6",
    );
    expect.equal(found?.tag_name, "legacy-v0.0.9");
  });

  test("never offers the app's own release to this edition", () => {
    // The order is the point: GitHub answers newest first, and the app's 0.4.0 is
    // both newer and higher than anything here. Its installer refuses Windows 10
    // and below 1803, so a machine running this edition would be handed a file
    // that cannot install — which is what `electron-updater` would have done.
    const found = newestRelease([release("v0.4.0"), release("legacy-v0.0.7")], "0.0.6");
    expect.equal(found?.tag_name, "legacy-v0.0.7");

    expect.equal(newestRelease([release("v0.4.0"), release("v1.0.0")], "0.0.6"), null);
  });

  test("stays quiet on a copy that is already the newest", () => {
    expect.equal(newestRelease([release("legacy-v0.0.6")], "0.0.6"), null, "the same version");
    expect.equal(newestRelease([release("legacy-v0.0.5")], "0.0.6"), null, "an older one");
    expect.equal(newestRelease([], "0.0.6"), null, "no releases at all");
    expect.equal(newestRelease([release("legacy-vnightly")], "0.0.6"), null, "an unreadable tag");
  });
});

suite("a signed manifest", () => {
  const good = (): Manifest => {
    const sha256 = "a".repeat(64);
    return { version: "0.0.7", installer: "app.exe", sha256, signature: sign("0.0.7", sha256) };
  };

  test("passes when this project's key signed it", () => {
    expect.ok(verifyManifest(good(), publicKey));
  });

  test("fails when the installer's digest was changed under it", () => {
    // The case the signature exists for: an installer swapped for another, with
    // the manifest edited to match the file that arrived.
    expect.ok(!verifyManifest({ ...good(), sha256: "b".repeat(64) }, publicKey));
  });

  test("fails when a signature is replayed onto another version", () => {
    // Signing the digest alone would let an old release's signature vouch for a
    // new version number, so the signed text carries both.
    const old = good();
    expect.ok(!verifyManifest({ ...old, version: "0.0.9" }, publicKey));
  });

  test("fails on another key, no signature, or nonsense", () => {
    const other = crypto.generateKeyPairSync("ed25519");
    const strangerSigned = crypto
      .sign(null, Buffer.from(signedText("0.0.7", "a".repeat(64)), "utf8"), other.privateKey)
      .toString("base64");

    expect.ok(!verifyManifest({ ...good(), signature: strangerSigned }, publicKey));
    expect.ok(!verifyManifest({ ...good(), signature: "" }, publicKey));
    expect.ok(!verifyManifest({ ...good(), signature: "not base64 at all" }, publicKey));
    expect.ok(!verifyManifest({ ...good(), sha256: "" }, publicKey));
  });

  test("is what the release script produces", () => {
    // The script signs `signedText` imported from this same module rather than a
    // copy of the string, so the two cannot drift apart. This holds the shape of
    // it, since a change here with no change there is the drift.
    expect.equal(signedText("0.0.7", "abc"), "stayinsured-legacy 0.0.7 abc");
  });
});

suite("the check as a whole", () => {
  const body = (version: string, sha256: string, signature?: string): Manifest => ({
    version,
    installer: "StayInsured-Win7-Probe-0.0.7.exe",
    sha256,
    signature: signature ?? sign(version, sha256),
  });

  /** Answers the releases list and then the manifest, as GitHub would. */
  function fakeGitHub(releases: ReleaseInfo[], manifest: unknown): (url: string) => Promise<Buffer> {
    return async (url: string) =>
      Buffer.from(JSON.stringify(url.includes("api.github.com") ? releases : manifest), "utf8");
  }

  test("offers the installer the manifest names", async () => {
    const sha256 = crypto.createHash("sha256").update("installer bytes").digest("hex");
    const found = await check(
      "0.0.6",
      fakeGitHub(
        [release("legacy-v0.0.7", ["latest.json", "StayInsured-Win7-Probe-0.0.7.exe"])],
        body("0.0.7", sha256),
      ),
      publicKey,
    );

    expect.equal(found?.version, "0.0.7");
    expect.equal(found?.sha256, sha256);
    expect.ok(found?.url.endsWith("StayInsured-Win7-Probe-0.0.7.exe"));
  });

  test("refuses a release whose manifest is signed by nobody", async () => {
    await expect.rejects(
      check(
        "0.0.6",
        fakeGitHub(
          [release("legacy-v0.0.7", ["latest.json", "StayInsured-Win7-Probe-0.0.7.exe"])],
          { ...body("0.0.7", "a".repeat(64)), signature: "" },
        ),
        publicKey,
      ),
      /not signed by this project's release key/,
    );
  });

  test("refuses a manifest that describes a different release", async () => {
    await expect.rejects(
      check(
        "0.0.6",
        fakeGitHub(
          [release("legacy-v0.0.7", ["latest.json", "StayInsured-Win7-Probe-0.0.7.exe"])],
          body("0.0.9", "a".repeat(64)),
        ),
        publicKey,
      ),
      /carries a manifest for 0\.0\.9/,
    );
  });

  test("refuses a release that publishes no manifest", async () => {
    await expect.rejects(
      check(
        "0.0.6",
        fakeGitHub([release("legacy-v0.0.7", ["StayInsured-Win7-Probe-0.0.7.exe"])], {}),
        publicKey,
      ),
      /publishes no latest\.json/,
    );
  });

  test("refuses a manifest naming an installer the release does not carry", async () => {
    await expect.rejects(
      check(
        "0.0.6",
        fakeGitHub([release("legacy-v0.0.7", ["latest.json"])], body("0.0.7", "a".repeat(64))),
        publicKey,
      ),
      /names an installer it does not carry/,
    );
  });
});

suite("downloading the installer", () => {
  const bytes = Buffer.from("this is not really an installer");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const update = { version: "0.0.7", url: "https://example.invalid/a/app.exe", sha256 };

  test("keeps a file that matches what was signed", async () => {
    const file = await download(update, async () => bytes);
    expect.ok(fs.existsSync(file));
    expect.equal(fs.readFileSync(file).toString(), bytes.toString());
    fs.rmSync(file, { force: true });
  });

  test("keeps nothing that does not", async () => {
    // A truncated download is a broken installer, and on this edition the
    // installer is the only thing between a machine and an application it runs.
    await expect.rejects(
      download({ ...update, sha256: "c".repeat(64) }, async () => bytes),
      /does not match the digest/,
    );
  });
});
