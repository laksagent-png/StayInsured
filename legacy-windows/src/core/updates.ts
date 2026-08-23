/**
 * The update channel for this edition.
 *
 * The app's own edition has one already: Tauri's updater reads a `latest.json`
 * from the newest release and installs nothing whose minisign signature does not
 * check out. This is the same shape by hand, for two reasons it cannot borrow
 * `electron-updater`.
 *
 * The first is that this edition's releases are tagged `legacy-v*` and published as
 * prereleases, so the two editions never publish under one another's name.
 * `electron-updater`'s GitHub provider resolves `releases/latest`, which is the
 * app's release, and its prerelease path takes the newest entry in the repository's
 * whole feed — also the app's release — while a tag it cannot read as a version is
 * skipped. Either way it offers a Windows 7 machine the installer that refuses to
 * run on Windows 7. Picking the release is therefore done here, by tag prefix.
 *
 * The second is that nothing signs these builds. Windows accepts the installer only
 * because the person running it agreed to; there is no certificate for the machine
 * to check. An update channel with no authenticity check would mean anything able to
 * serve that release URL could hand an application to a machine running an operating
 * system that stopped receiving security fixes in 2020. So the manifest is signed
 * with a key held only by this repository, the public half is compiled in below, and
 * an unsigned or wrongly signed manifest is not an update — it is nothing.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";

/**
 * The public half of the key in `scripts/update-keygen.js`, as SPKI DER in base64.
 *
 * Replacing this is a breaking change for every copy already installed: they hold
 * the old key and will refuse anything signed with the new one until somebody
 * updates them by hand.
 */
const RELEASE_PUBLIC_KEY = "MCowBQYDK2VwAyEA5CAXvZoSn2UW5UGgSR8ia6xa+pDYKjEwTk5eJHddlW4=";

/** Only this edition's releases carry this, which is how its own are recognised. */
const TAG_PREFIX = "legacy-v";

const RELEASES = "https://api.github.com/repos/laksagent-png/StayInsured/releases?per_page=30";

/** What CI publishes beside the installer. `signature` covers the other two. */
export interface Manifest {
  version: string;
  installer: string;
  sha256: string;
  signature: string;
}

export interface Available {
  version: string;
  url: string;
  sha256: string;
}

/** Enough of GitHub's release JSON to choose one and find its files. */
export interface ReleaseInfo {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

export type Fetcher = (url: string) => Promise<Buffer>;

/**
 * Compares two `x.y.z` versions, with anything after a hyphen ignored.
 *
 * Hand-rolled rather than pulled in, because the whole vocabulary this needs is
 * "is that one higher than this one" over three numbers we publish ourselves.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .split("-")[0]!
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * The newest release of this edition, or null when the newest is the one running.
 *
 * A release of the app itself is not one of these, however new it is: its tag
 * carries no prefix, and its installer would refuse the machine this is running on.
 */
export function newestRelease(releases: ReleaseInfo[], current: string): ReleaseInfo | null {
  let best: { release: ReleaseInfo; version: string } | null = null;

  for (const release of releases) {
    if (!release.tag_name?.startsWith(TAG_PREFIX)) continue;
    const version = release.tag_name.slice(TAG_PREFIX.length);
    if (!/^\d+\.\d+\.\d+/.test(version)) continue;
    if (compareVersions(version, current) <= 0) continue;
    if (best === null || compareVersions(version, best.version) > 0) {
      best = { release, version };
    }
  }

  return best?.release ?? null;
}

/**
 * Whether the manifest was signed by whoever holds the release key.
 *
 * The signature covers the version and the digest together, so one that was
 * published for an earlier release cannot be replayed to attach its installer to a
 * later version number.
 */
export function verifyManifest(manifest: Manifest, publicKeyBase64 = RELEASE_PUBLIC_KEY): boolean {
  if (!manifest.signature || !manifest.sha256 || !manifest.version) return false;

  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKeyBase64, "base64"),
      format: "der",
      type: "spki",
    });
    return crypto.verify(
      null,
      Buffer.from(signedText(manifest.version, manifest.sha256), "utf8"),
      key,
      Buffer.from(manifest.signature, "base64"),
    );
  } catch {
    // A malformed key or signature is a failed check, not a crash on somebody's
    // laptop: the answer either way is that there is no update to offer.
    return false;
  }
}

/** What the signature is over. CI signs exactly this string. */
export function signedText(version: string, sha256: string): string {
  return `stayinsured-legacy ${version} ${sha256}`;
}

/**
 * Looks for a newer release, and returns it only if its manifest is signed.
 *
 * Anything unexpected — no network, a rate-limited API, a release with no manifest
 * because it was built before the signing key existed — means no update is on
 * offer. The caller shows nothing, which is what it shows on a current machine.
 */
export async function check(
  current: string,
  fetcher: Fetcher = get,
  publicKey = RELEASE_PUBLIC_KEY,
): Promise<Available | null> {
  const releases = JSON.parse((await fetcher(RELEASES)).toString("utf8")) as ReleaseInfo[];
  const release = newestRelease(releases, current);
  if (release === null) return null;

  const manifestAsset = release.assets.find((a) => a.name === "latest.json");
  const version = release.tag_name.slice(TAG_PREFIX.length);
  if (!manifestAsset) {
    throw new Error(`Release ${release.tag_name} publishes no latest.json, so it cannot be verified.`);
  }

  const manifest = JSON.parse((await fetcher(manifestAsset.browser_download_url)).toString("utf8")) as Manifest;
  if (manifest.version !== version) {
    throw new Error(`Release ${release.tag_name} carries a manifest for ${manifest.version}.`);
  }
  if (!verifyManifest(manifest, publicKey)) {
    throw new Error(`The manifest for ${release.tag_name} is not signed by this project's release key.`);
  }

  const installer = release.assets.find((a) => a.name === manifest.installer);
  if (!installer) {
    throw new Error(`Release ${release.tag_name} names an installer it does not carry.`);
  }

  return { version, url: installer.browser_download_url, sha256: manifest.sha256 };
}

/**
 * Fetches the installer and keeps it only if it is the file the manifest describes.
 *
 * The digest is the whole point of downloading to a temporary file first: a
 * truncated download is a broken installer, and on this edition the installer is
 * the only thing standing between a machine and an application it will run.
 */
export async function download(update: Available, fetcher: Fetcher = get): Promise<string> {
  const body = await fetcher(update.url);
  const digest = crypto.createHash("sha256").update(body).digest("hex");
  if (digest !== update.sha256.toLowerCase()) {
    throw new Error("The downloaded installer does not match the digest its release was signed with.");
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stayinsured-update-"));
  const file = path.join(dir, path.basename(new URL(update.url).pathname));
  fs.writeFileSync(file, body);
  return file;
}

/** GETs a URL, following the redirects GitHub answers asset downloads with. */
function get(url: string, redirects = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error(`Too many redirects fetching ${url}`));
      return;
    }

    https
      .get(
        url,
        {
          headers: {
            // GitHub's API refuses a request with no user agent.
            "user-agent": "StayInsured-legacy-updater",
            accept: "application/vnd.github+json, application/octet-stream, */*",
          },
        },
        (response) => {
          const { statusCode = 0, headers } = response;
          if (statusCode >= 300 && statusCode < 400 && headers.location) {
            response.resume();
            get(new URL(headers.location, url).toString(), redirects + 1).then(resolve, reject);
            return;
          }
          if (statusCode !== 200) {
            response.resume();
            reject(new Error(`${url} answered ${statusCode}`));
            return;
          }

          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => resolve(Buffer.concat(chunks)));
          response.on("error", reject);
        },
      )
      .on("error", reject);
  });
}
