# StayInsured

A desktop client-and-policy manager for an insurance agency. Everything lives on
your machine in an encrypted database; nothing is sent anywhere.

Runs on macOS, Windows and Linux from the same codebase (Tauri 2: a Rust core
with a React user interface).

**This file is for developers.** If you want to install and use the app, read the
[README](README.md) and download an installer from the
[releases page](https://github.com/laksagent-png/StayInsured/releases).

Deeper reference lives in [docs/technical/](docs/technical/):
[DESIGN](docs/technical/DESIGN.md) for the architecture and the reasoning behind
it, [API](docs/technical/API.md) for the command contract,
[DATA-MODEL](docs/technical/DATA-MODEL.md) for the schema.

## What it does today

- **Clients** — contact details, addresses, insured family members, archive
  instead of delete, full-text search.
- **Policies** — one client can hold any number of policies (health, life,
  motor, travel, and so on). Each year of a policy is its own record linked into
  a renewal chain, so history is preserved rather than overwritten.
- **Renewals desk** — policies grouped by how soon they lapse: overdue, 7, 30,
  60 and 90 days. Renewing pre-fills from last year and starts the next link in
  the chain.
- **Dashboard** — book size, premium under management, commission, what expires
  when, and the split by category.
- **Import** — load an Excel or CSV file, map the columns (the app guesses),
  validate with a dry run that changes nothing, then commit. Re-importing the
  same file does not create duplicates.
- **Export** — any filtered list to `.xlsx` or `.csv`.
- **Insurers and products** — a catalogue that keeps naming consistent.

Reminder emails, reports and document storage are the next phases; the schema
and settings for them are already in place.

## Security

- The database is SQLCipher-encrypted at rest.
- The key is derived from your app password with Argon2id; the password itself
  is never stored.
- Optionally the derived key is kept in the OS keychain (macOS Keychain, Windows
  Credential Manager, Linux Secret Service) so daily unlocking is one click.
  Turning that off means typing the password every time.
- Lose the password with no keychain entry and the data is unrecoverable. That
  is the point of encryption; keep a copy of the password somewhere safe.

## Requirements

- Node.js 18 or newer
- Rust 1.82 or newer (`https://rustup.rs`)
- Platform build tools: Xcode Command Line Tools on macOS, Microsoft C++ Build
  Tools on Windows, `webkit2gtk` and `libayatana-appindicator` on Linux

## Running it

```bash
npm install
npm run app          # development, with hot reload
```

To produce an installer for the machine you are on:

```bash
npm run app:build    # output in src-tauri/target/release/bundle
```

Other scripts: `npm run dev` (web only), `npm run build` (typecheck and bundle
the frontend), `npm run icons` (regenerate app and tray icons).

The user-facing [agent's guide](docs/guide/README.md) is illustrated from the
running app, so a change to any screen means re-photographing it:

```bash
npm run docs:screenshots   # drives every route and dialog, writes docs/guide/screenshots
npm run docs:check         # fails on a route, control or screenshot the guide misses
```

`scripts/docs/` holds the capture: `fixtures.mjs` is the fictional demo book,
`mock-tauri.mjs` answers the Rust commands in the browser, and `capture.mjs`
takes the pictures with a frozen clock so only real changes show up in a diff.
The **Documentation** workflow runs both commands on every pull request.

Rust tests cover the data layer end to end — migrations, renewal chains, status
rules, import idempotency, export, backup:

```bash
cd src-tauri && cargo test --lib
```

## Cutting a release

GitHub Actions builds both installers. Bump the version in the three places
that carry it, then tag:

```bash
# src-tauri/tauri.conf.json, src-tauri/Cargo.toml, package.json
git commit -am "Release 0.2.0"
git tag v0.2.0
git push origin main --tags
```

The workflow refuses to build if the tag and the app version disagree, so the
installers can never ship under the wrong number. It publishes a release with a
universal macOS `.dmg` and a Windows `.exe` and `.msi`.

To test a build without announcing a version, run the **Build installers**
workflow by hand from the Actions tab; it attaches the installers to the run
instead of creating a release.

Releases are unsigned, so macOS and Windows both warn on first launch. The
workflow attaches instructions to every release, and the [README](README.md)
covers it too. Signing needs a paid Apple Developer account and a Windows
certificate.

## Where the app keeps its data

| Platform | Location |
| --- | --- |
| macOS | `~/Library/Application Support/com.stayinsured.app` |
| Windows | `%APPDATA%\com.stayinsured.app` |
| Linux | `~/.local/share/com.stayinsured.app` |

Inside: `stayinsured.db` (encrypted), `vault.json` (key derivation parameters —
not the key), `documents/`, `backups/`, `logs/`. **Settings → Reveal data
folder** opens it.

Backups are encrypted copies of the database. Point the backup folder at a
Google Drive or Dropbox directory if you want them off the machine.

## How the code is laid out

```
src/                    React + TypeScript interface
  lib/api.ts            typed wrapper over every Rust command
  lib/types.ts          mirrors the Rust models
  pages/                one file per screen
  components/           shared widgets and forms
src-tauri/src/
  commands.rs           the whole API surface exposed to the interface
  db/                   connection, migrations, SQL schema
  repo/                 queries, one module per entity
  importer.rs           spreadsheet reading, mapping, validation
  exporter.rs           xlsx and csv writing
  vault.rs              password hashing, key derivation, keychain
  tests.rs              data-layer tests
```

The interface never writes SQL. It calls commands; commands call repositories;
repositories own the queries. Adding a screen means adding a command and a page,
not touching the database layer.

[DESIGN](docs/technical/DESIGN.md) explains why each layer is shaped the way it
is, [API](docs/technical/API.md) lists every command with its arguments and
error kinds, and [DATA-MODEL](docs/technical/DATA-MODEL.md) documents the tables
and the invariants they hold.
