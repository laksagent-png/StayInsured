# StayInsured

A desktop client-and-policy manager for an insurance agency. Everything lives on
your machine in an encrypted database; nothing is sent anywhere.

Runs on macOS, Windows and Linux from the same codebase (Tauri 2: a Rust core
with a React user interface).

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

Rust tests cover the data layer end to end — migrations, renewal chains, status
rules, import idempotency, export, backup:

```bash
cd src-tauri && cargo test --lib
```

## First run

The app asks you to set an owner name and an app password, then creates the
encrypted database. From there, either add clients by hand or go to **Import**,
download the template, fill it in, and load it.

## Where your data lives

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
