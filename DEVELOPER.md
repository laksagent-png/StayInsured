# StayInsured

A desktop client-and-policy manager for an insurance agency. Everything lives on
your machine in an encrypted database; nothing is sent anywhere.

Runs on macOS, Windows 10 version 1803 or newer, and Linux from the same codebase
(Tauri 2: a Rust core with a React user interface).

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
- **Reminders** — a rule ladder measured from expiry, templates edited in the
  app, an outbox that guarantees one send per policy year, and a daily sweep
  over the agent's own SMTP server. The engine takes `Sender` and `Alerter`
  trait objects, so it is tested without a mail server or a window.

Reports, document storage, premium and commission tracking, claims and
multi-user logins are the next phases; the schema for them is already in place.

## Security

- The database is SQLCipher-encrypted at rest.
- The key is derived from your app password with Argon2id; the password itself
  is never stored.
- Optionally the derived key is kept in the OS keychain (macOS Keychain, Windows
  Credential Manager, Linux Secret Service) so daily unlocking is one click.
  Turning that off means typing the password every time.
- Lose the password with no keychain entry and the data is unrecoverable. That
  is the point of encryption; keep a copy of the password somewhere safe.
- The SMTP password lives in the same keychain, never in the database, so a
  backup copied to a cloud folder carries no working credential.
- One copy of the app runs per machine: a second launch hands over to the one
  already running rather than opening the same book twice. Encryption is no help
  against that particular fault, since both copies hold the key.

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

To fill an empty book for testing by hand:

```bash
npm run sample:data        # writes sample-data/, then import the files in order
```

Expiries are measured from the day it runs, so every renewal window, dashboard
bucket and reminder rule has a policy sitting on its boundary.
`sample-data/README.md` states the counts each screen should then show.

The user-facing [agent's guide](docs/guide/index.md) is illustrated from the
running app, so a change to any screen means re-photographing it:

```bash
npm run docs:screenshots   # drives every route and dialog, writes docs/guide/screenshots
npm run docs:check         # fails on a route, control or screenshot the guide misses
```

The guide and the landing page are published to
https://laksagent-png.github.io/StayInsured/ by the **Site** workflow, which
re-photographs the app and runs the same checks before it deploys. VitePress
builds it from `docs/`, configured in `docs/.vitepress/config.ts`:

```bash
npm run docs:dev       # the site with hot reload
npm run docs:build     # what CI publishes
npm run docs:preview   # serve the built site
```

`docs/technical/` is deliberately left out of the site and read on GitHub. Adding
a guide page means adding it to the sidebar in the config as well as to the
contents page; `docs:check` fails when the two disagree.

`scripts/docs/` holds the capture: `fixtures.mjs` is the fictional demo book,
`mock-tauri.mjs` answers the Rust commands in the browser, and `capture.mjs`
takes the pictures with a frozen clock so only real changes show up in a diff.
The **Documentation** workflow runs both commands on every pull request.

## Checks

One command runs everything that guards the code:

```bash
npm run check          # typecheck, the interface tests, then rustfmt, clippy and the Rust tests
```

Rust tests cover the data layer end to end — migrations, renewal chains, status
rules, import idempotency, export, backup, documents, and the reminder engine
against a recording fake mailer. To run them alone:

```bash
cd src-tauri && cargo test --lib
```

### The interface tests

Vitest drives the React side in jsdom, one file per screen or component in
`__tests__/` beside the code it covers:

```bash
npm test               # the whole suite
npm run test:watch     # while you work
npx vitest run src/pages/__tests__/Clients.test.tsx
```

The Rust core is replaced by a book held in memory. `src/test/backend.ts`
answers every command the app can send, filtering, sorting, paginating and
writing the way the repositories do — down to refusing what they refuse and
tidying names, phones and blanks the way `util.rs` does — and records what it was
asked so a test can prove a screen sent the filter it displayed.
`src/test/fixtures.ts` is the same demo book the guide screenshots use, and the
clock is frozen to 14 August 2026, so "expires in 7 days" means one particular
policy in every test. `src/test/tauri.ts` stands in for the file picker, the tray
events, autostart and the updater. `src/test/README.md` is the contract for
writing a new test.

When the core's behaviour changes, the fake has to change with it, or the tests
go on proving the app works against a core that no longer exists.

A test that proves the app misbehaves is marked `it.fails` with a comment naming
the bug: the suite stays green, and fixing the bug turns the marker red so it
gets removed.

Clippy runs with `-D warnings`, so a warning fails the run. Formatting is
rustfmt's default; `cargo fmt` fixes what `cargo fmt --check` reports. Both need
components rustup does not install by default:

```bash
rustup component add rustfmt clippy
```

Commits go straight to `main`, so the checks run before the push rather than on
a pull request. Enable the hook once per clone:

```bash
npm run hooks          # points git at .githooks
```

`.githooks/pre-push` then runs `npm run check` on every push, and
`git push --no-verify` skips it when something has to go out regardless. The
**Checks** workflow runs the same commands on every push to `main`, so a push
that skipped the hook — or came from a clone where it was never enabled — is
still caught.

Every Node job in CI installs with `npm ci`, which refuses a `package-lock.json`
that disagrees with `package.json`. Adding a dependency means committing the
lockfile with it; leaving it behind fails every workflow at the first step,
before a single check has run.

## Cutting a release

GitHub Actions builds both installers. Rename the **Upcoming** heading in
[CHANGELOG.md](CHANGELOG.md) to the version and its date, open a fresh Upcoming
section above it, bump the version in the three places that carry it, then tag:

```bash
# CHANGELOG.md, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, package.json
git commit -am "Release 0.2.0"
git tag v0.2.0
git push origin main --tags
```

The workflow refuses to build if the tag and the app version disagree, or if the
changelog has no section for that version, so the installers can never ship
under the wrong number or with nothing to say for themselves. The release body
is the changelog section plus the standing install instructions, and it carries
a universal macOS `.dmg` with a Windows `.exe` and `.msi`.

`src-tauri/installer-hooks.nsh` stops the `.exe` on anything older than Windows
build 17134, which is Windows 10 version 1803. Three layers rule the older
versions out independently: WebView2 has not supported Windows 7, 8 or 8.1 since
January 2024, the Rust standard library dropped them in 1.78, and Tailwind 4
needs Chromium 111 for the `oklch()` and `color-mix()` colours it compiles to.
Since none of that can be worked around from the installer, it explains the
problem instead of leaving behind a shortcut that dies on launch. It refuses in
`.onGUIInit` before the wizard draws a page, and again in `NSIS_HOOK_PREINSTALL`
for a silent install, where `.onGUIInit` never runs. An unreadable build number
lets the machine through, because a wrong guess turns away a machine the app
would have run on. The `.msi` carries no equivalent check — WiX would need
Tauri's whole template overridden for it — and every release points Windows
users at the `.exe`.

Every user-visible change adds a line under **Upcoming** as it is made, not at
release time — the person who made the change is the one who knows what it means
for an agent. The same file is published at
https://laksagent-png.github.io/StayInsured/release-notes.html, included from the
site rather than copied into it.

To test a build without announcing a version, run the **Build installers**
workflow by hand from the Actions tab; it attaches the installers to the run
instead of creating a release.

Every run keeps the installers on itself, tagged ones included. GitHub once
refused to create the release after both platforms had finished building, for no
reason the log could explain and none that was still true minutes later; the
copies mean that if it happens again the installers can be attached to the
release by hand instead of built again.

Releases are unsigned, so macOS and Windows both warn on first launch. The
workflow attaches instructions to every release, and the [README](README.md)
covers it too. Signing needs a paid Apple Developer account and a Windows
certificate.

### The updater signing key

Every release also carries `latest.json` and a signed archive per platform, and
an installed app offers the update on its next launch. Repository secrets under
**Settings → Secrets and variables → Actions** make that happen:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | The whole contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The key's password. Leave the secret uncreated when the key has none |

GitHub refuses to store a secret with no value, so a key without a password
means simply not adding the second secret. The workflow reads it either way, and
an absent secret arrives as the empty string the signer expects.

The keypair is made once with `npm run tauri signer generate -w <path>`. Its
public half is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`; its
private half never enters the repository. This is a minisign key and has nothing
to do with Apple or Windows code signing — it is what stops an installed app
accepting a build this repository did not publish.

Losing the private key means no copy already out there can be updated again,
because every install only trusts the public key it shipped with. Changing the
key has the same effect. Keep a copy somewhere a lost laptop does not take with
it.

Without the secrets the build still succeeds and still produces installers; it
simply publishes no update anyone can take. A release worth announcing is one
where `latest.json` is among the assets.

## The Windows 7 edition

`legacy-windows/` is a second edition of the app for machines the app itself
refuses. It needs Windows 10 version 1803 or newer; reaching older machines means
Electron 22 — the last release supporting them — with the Rust core reimplemented
in TypeScript. Whether that was even possible rested on one question, and a probe
answered it: run on a Windows 7 SP1 machine, every check passes. The probe is still
there and CI still runs it, because evidence that stops being re-run stops being
evidence.

Two things about it are worth knowing before reading a line of it.

**It does not encrypt.** The app derives a SQLCipher key from the password; this
edition opens a plain SQLite file. `session_state` reports `encrypted: false`, and
the lock screen and Settings — the same components, shared — print a warning where
they otherwise promise an encrypted database. That flag is the whole mechanism by
which the shared interface stays honest about which core it is talking to, so a
screen that claims encryption must read it rather than assume it.

**The port is complete, except for encryption.** All 73 commands answer for real:
the session and password wall, settings, clients, members, insurers, products,
policies with the renewal chain and the status sweep, the dashboard, the spreadsheet
importer, both exporters, document attachments, and the whole reminder side — rules,
templates, the outbox, the daily sweep and SMTP. `npm test` counts it rather than
trusting this paragraph: `parity.test.ts` reads the command list out of
`src-tauri/src/lib.rs`, fails if the two editions disagree about a single name, and
prints how many answer.

Three differences remain, and they are differences in kind rather than gaps.
Encryption, as above. Sending, which is `nodemailer` where the app has `lettre`, and
which forces the sweep into two phases: a better-sqlite3 transaction cannot span an
`await`, so deciding and queueing hold the transaction and each delivery commits its
own result. A run cut short therefore leaves what it sent marked as sent, rather
than rolling those marks back and writing to the same clients twice — the safer half
of that trade, and the reason the outbox is written before anything leaves. And the
sweep is a timer asking once a minute whether today's run has happened, not a thread
sleeping until nine, so a laptop asleep at nine sweeps when it opens and a machine
off for a week catches up once rather than sending a week of reminders.

It also has a shell of its own now: a tray icon and menu matching `tray.rs`, a
window that hides into it on close, and a single-instance guard so a second launch
focuses the running copy rather than opening a second connection to one book. The
app answers a second launch the same way, through
`tauri-plugin-single-instance`. `--probe` and `--capture` deliberately skip the
guard here, so the diagnostics still run beside an open app; the app has no
diagnostics to skip it.

```bash
cd legacy-windows
npm install
npm start            # the app
npm test             # the ported rules
npm run probe        # the Windows 7 checks, printed
```

The cost that decides this edition's future is not the porting but the drift: every
rule in `src-tauri/src/` now exists twice and has to keep agreeing with itself.
`npm test` is the answer to that, and the only one available. Each case is ported
from the Rust test of the same name and says so, so the two suites can be read side
by side; when a rule changes in `src-tauri/src/tests.rs`, the case it changed is
where this edition finds out it has fallen behind. It runs under
`ELECTRON_RUN_AS_NODE` rather than `vitest`, because `better-sqlite3` here is built
against Electron's ABI and the machine's own Node cannot load it at all.

The interface is not copied. `vite.config.ts` builds the app's own `src/` with the
`@tauri-apps/*` imports aliased onto shims over Electron IPC, and compiles the CSS
down for Chromium 108, which has none of `oklch()`, `color-mix()` or `@property`.
Two copies of the screens would drift the way two copies of the rules threaten to,
except that nothing would be testing it.

The probe checks that Electron 22 starts, that the `better-sqlite3` native module
loads, and that the migrations apply to a plain, unencrypted SQLite file with a
client row written and read back. The schema comes from `src-tauri/src/db/schema`
rather than a copy, so neither the probe nor the edition can pass against a schema
the core has moved on from. `legacy-windows/README.md` covers the rest.

Its release is separate from the app's. Pushing a `legacy-v*` tag runs **Build
the Windows 7 probe** and publishes as a prerelease; the `v*` tags the app
releases under never match it, and that installer deliberately carries no Windows
version guard. GitHub's runners start at Windows Server 2019, so CI shows only
that the installer builds, the schema applies and the ported rules still agree.
The Windows 7 answer came from carrying that installer to a Windows 7 SP1 machine,
which is the only place it could come from, and where any further claim about
Windows 7 has to be earned.

### The Windows 7 edition's update channel

It has one, and it is its own. The interface is shared, so `src/lib/updates.ts`
makes the same offer on the same once-per-launch rule in both editions; underneath,
`legacy-windows/src/core/updates.ts` does what Tauri's updater plugin does for the
app, for two reasons it cannot use `electron-updater`.

The first is release selection. `electron-updater`'s GitHub provider resolves
`releases/latest`, which is the app's release, and its prerelease path takes the
newest entry in the repository's whole feed — also the app's release — while a
`legacy-v*` tag fails `semver.valid` and is skipped. Any of those paths offers a
Windows 7 machine the installer that refuses Windows 7 on purpose. So the release is
chosen here by tag prefix, and a test holds it to never choosing the app's.

The second is authenticity. Nothing signs these builds for Windows to check, so a
channel with no signature of its own would mean anything able to serve that release
URL could hand an application to a machine whose operating system stopped receiving
security fixes in 2020. Each release therefore carries a `latest.json` signed with
an ed25519 key, whose public half is compiled into `core/updates.ts`:

| Secret | Value |
| --- | --- |
| `LEGACY_UPDATE_SIGNING_KEY` | The whole contents of the private key file |

`node scripts/update-keygen.js` makes the pair, writes the private half outside the
repository and prints only the public half. The signature covers the version and the
installer's digest together, so a manifest cannot be replayed from an old release to
vouch for a new version number, and the app checks the downloaded installer against
that digest before running it. Unlike the app's channel, a missing secret **fails the
release** rather than publishing quietly: a build nobody can update to is worth
stopping for.

Losing the key has the same consequence it has for the app — every copy already
installed trusts only the public key it shipped with, so replacing the key means
updating those copies by hand once.

Updates are offered on Windows only. The Mac disk images below are unsigned
developer builds, and a copy replaced behind Gatekeeper's back would not open. What
somebody sees also ends slightly differently from the app: Windows cannot replace the
files of a running program, so the installer's own window opens and the app closes,
rather than the app updating in place and offering to restart.

The same release carries two Mac disk images, from `npm run package:mac`. They
answer nothing about Windows 7; they exist so the *packaged* app can be run on a
machine we already have. A packaged app reads the schema from its resources
directory and loads the native module from inside the bundle, and `npm start`
exercises neither. Both are paths the Windows installer depends on, so a mistake
in either shows up on a Mac in seconds rather than on a virtual machine. Nothing
signs them, so macOS quarantines a downloaded copy; `legacy-windows/README.md`
has the one command that clears it.

Nothing there ships with the app. `npm run check` at the root does not see it, and
no behaviour of the app depends on it — with one exception, which is the
`encrypted` flag on `SessionState` and the two screens that read it.

## Where the app keeps its data

| Platform | Location |
| --- | --- |
| macOS | `~/Library/Application Support/com.stayinsured.app` |
| Windows | `%APPDATA%\com.stayinsured.app` |
| Linux | `~/.local/share/com.stayinsured.app` |

Inside: `stayinsured.db` (encrypted), `vault.json` (key derivation parameters —
not the key), `backups/`, `logs/`. **Settings → Reveal data folder** opens it.
Attached documents are blobs in the database rather than files on disk, so the
whole book is one file.

Backups are encrypted copies of the database. Point the backup folder at a
Google Drive or Dropbox directory if you want them off the machine.

## How the code is laid out

```
src/                    React + TypeScript interface
  lib/api.ts            typed wrapper over every Rust command
  lib/types.ts          mirrors the Rust models
  pages/                one file per screen
  components/           shared widgets and forms
  test/                 the fake core, the demo book and the render helpers
  **/__tests__/         interface tests, beside the code they cover
src-tauri/src/
  commands.rs           the whole API surface exposed to the interface
  db/                   connection, migrations, SQL schema
  repo/                 queries, one module per entity
  importer.rs           spreadsheet reading, mapping, validation
  exporter.rs           xlsx and csv writing
  reminders.rs          due matching, the outbox, the retry and cap rules
  templating.rs         placeholder rendering and escaping
  mail.rs               SMTP transport and the plain-text part
  scheduler.rs          the once-a-minute tick behind the daily sweep
  vault.rs              password hashing, key derivation, keychain
  tests.rs              data-layer tests
legacy-windows/         the Windows 7 edition: the core in TypeScript, unencrypted
```

The interface never writes SQL. It calls commands; commands call repositories;
repositories own the queries. Adding a screen means adding a command and a page,
not touching the database layer.

[DESIGN](docs/technical/DESIGN.md) explains why each layer is shaped the way it
is, [API](docs/technical/API.md) lists every command with its arguments and
error kinds, and [DATA-MODEL](docs/technical/DATA-MODEL.md) documents the tables
and the invariants they hold.
