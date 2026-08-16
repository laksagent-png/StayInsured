# The Windows 7 edition

StayInsured needs Windows 10 version 1803 or newer, because WebView2, the Rust
standard library and Tailwind 4 each rule out Windows 7, 8 and 8.1 on their own.
Reaching those machines means a parallel edition built on Electron 22, the last
release that supports them, with the Rust core rewritten in TypeScript.

This directory began as the one experiment that decided whether that edition was
worth building. It passed, and the edition is now being built here.

## Two things it is not

**It is not encrypted.** The app opens SQLCipher with a key derived from the
password, so the file on disk is unreadable without it. This edition opens a plain
SQLite file. The password still guards the interface, but anyone holding the file —
or a backup of it, or the disk — can read every client in it. `session_state`
reports `encrypted: false`, and the lock screen and Settings say so in place of the
promises they make in the app. Do not quietly reword them.

**It is not finished.** The core is a port in progress. What is not built refuses
with a message saying so rather than half working: importing a spreadsheet,
exporting, documents, the reminder outbox and everything that sends mail.
`src/core/commands.ts` is the list, and the bottom of it is the honest part.

## The probe, and what it answered

It passes on Windows 7 SP1. Electron 22 starts, the native SQLite module loads,
and the app's real schema applies to a plain file with a row written and read back.

| Question | Why it decided anything |
| --- | --- |
| Does Electron 22 start on Windows 7? | Nothing else matters if the shell will not run |
| Does the `better-sqlite3` native module load? | A native module has to match Electron's ABI, and prebuilt binaries for this combination may no longer exist |
| Does the app's real schema apply to a plain SQLite file? | The `.sql` files in `src-tauri/src/db/schema` are the part this edition reuses rather than rewrites |
| Which modern CSS does this Chromium understand? | It says how much of Tailwind 4 has to be compiled down for Chromium 108 |

The probe stays, and CI runs it on every build. It is the evidence, and evidence
that is not re-run stops being evidence. The schema is read from
`src-tauri/src/db/schema` rather than copied here, so neither the probe nor this
edition can pass against a schema the app has since moved on from.

## How it is put together

| Directory | What is in it |
| --- | --- |
| `src/core/` | The port of `src-tauri/src/`. Imports no Electron, so the tests can run without one |
| `src/env.ts` | The one place Electron meets the core: paths, `safeStorage` for secrets, revealing a folder |
| `src/main.ts` | The main process, the IPC bridge, and the probe's four launch modes |
| `src/tests/` | The ported rules held against the cases `src-tauri/src/tests.rs` holds them to |
| `ui/shims/` | `@tauri-apps/*` reimplemented over Electron IPC, so the app's React source builds unchanged |

The interface is the app's own `src/`, not a copy. `vite.config.ts` aliases the
Tauri modules onto the shims and compiles the CSS down for Chromium 108, which has
none of `oklch()`, `color-mix()` or `@property`. Editing a screen twice would
guarantee the two editions drift; this way a change to the app arrives here on the
next build.

## Running it

```bash
cd legacy-windows
npm install
npm start              # the app
npm test               # the core tests
npm run probe          # the Windows 7 checks, printed, no window
```

`.npmrc` is what makes the install work. A native module has to match Electron's
ABI rather than the ABI of whatever Node is on the machine, so it pins `runtime`,
`target` and `disturl`. Without it, `better-sqlite3` builds against local Node
headers and either fails outright or produces a binary Electron cannot load.

`xlsx` comes from `cdn.sheetjs.com` rather than the npm registry, which is how its
authors now publish it. The copy still on npm is 0.18.5 and carries unfixed
prototype-pollution and denial-of-service advisories; this app parses spreadsheets
that arrive from other people's offices, so it takes the patched build. SheetJS
reads what `calamine` reads on the Rust side — xlsx, xls, xlsm and ods — which is
what the import screen offers.

That same pinning is why `npm test` does not use `vitest` the way the app does:
the module cannot be loaded by the machine's own `node` at all. The tests run under
`ELECTRON_RUN_AS_NODE`, which is Electron's Node with the matching ABI and no
Electron APIs — the environment `src/core/` is written for. `scripts/run-tests.js`
sets that up, and `src/tests/harness.ts` explains the rest.

The probe's window lists each check as PASS or FAIL and saves the same report as
`probe-report.json` in the app's data folder, so a run on someone else's machine
can be sent back as a file rather than described. `npm run probe` prints the same
result and exits non-zero on a failure, which is how the build machine reads it.

## The tests are the point

Two implementations of the same rules drift, and the drift is silent. A renewal
chain that forks, a lapse sweep a day out, a date read as the fourth of March
instead of the third of April — none of these raise an error. They show up as a
client whose renewal was never on the desk.

So `src/tests/` is not a smoke test. Each case is ported from the Rust test of the
same name and names it in a comment, and the two suites are meant to be read side
by side. When a rule changes in `src-tauri/src/`, the test that changes with it is
the notice that this edition has fallen behind.

## Building the installer

```bash
npm run package:win    # dist/StayInsured-Win7-Probe-0.0.3.exe
```

One installer covers every Windows 7 machine. It carries both 64-bit and 32-bit
builds and installs whichever fits, since asking an owner which they have is not a
reasonable question. Prebuilt `better-sqlite3` binaries exist for Electron 22 on
both architectures, so nothing compiles from source.

A 32-bit-only installer would also run everywhere and would be half the size, at
the cost of the 32-bit memory ceiling. That is the simplification to reach for if
the download size matters more than headroom.

Build it on Windows: packaging rebuilds the native module for the target. The
**Build the Windows 7 probe** workflow does the same on a runner, either by hand
from the Actions tab or by pushing a `legacy-v*` tag, which publishes it as a
prerelease.

Note that this installer carries no Windows version guard, unlike the app's own
installer. Refusing old Windows is the whole point of that one, and running on old
Windows is the whole point of this one.

## Building for a Mac

```bash
npm run package:mac    # dist/StayInsured-Win7-Probe-0.0.3-arm64.dmg, and -x64
```

A Mac build answers none of the Windows 7 questions. Chromium 108 on macOS says
nothing about Chromium 108 on Windows 7, and the machine it runs on was never in
doubt.

What it does is run the app as it is packaged rather than as it is developed. The
packaged app reads the schema from `Contents/Resources/schema` and loads the
native module out of the app bundle, and `npm start` uses neither path. Both are
the paths the Windows installer depends on, so a packaging mistake surfaces here
in seconds instead of on a virtual machine.

Two builds rather than one universal binary, because a universal app means
merging better-sqlite3's two native binaries and the only people opening these
files already know which Mac they own.

Nothing signs these, so a downloaded copy is quarantined and macOS refuses it on
the grounds that the developer cannot be verified. Right-click the app and choose
**Open**, or strip the flag:

```bash
xattr -dr com.apple.quarantine "/Applications/StayInsured Windows 7 probe.app"
```

A build made on your own machine is not quarantined and needs neither. To check
it without a window:

```bash
"dist/mac-arm64/StayInsured Windows 7 probe.app/Contents/MacOS/StayInsured Windows 7 probe" --probe-only
```

That prints the same report and exits non-zero on a failure. It also prints a
`mach_port_rendezvous` error on the way out, which is a helper process noticing
the app has already quit and means nothing.

## Seeing the interface without a Windows 7 machine

```bash
npm start
npx electron . --capture /tmp/si.png
npx electron . --capture /tmp/si.png --route /settings --unlock "your password"
```

`--capture` saves a picture of the rendered window and exits. Whether the CSS
compiled down correctly is a question about pixels, and this answers it from the
machine in question without anyone having to describe what they see — including
from a Windows 7 machine, where there is otherwise no way to look.

`--route` names a screen, since the interface routes on the hash. `--unlock` opens
the book first, for the screens behind the lock; it is ignored in a packaged build,
which has no business taking a password off a command line. Add
`--user-data-dir=/tmp/somewhere` to do any of this against a scratch book rather
than your own.

## What none of this tells you

GitHub's runners start at Windows Server 2019, so CI proves only that the
installer builds and the rules still agree. The Windows 7 answer was earned by
carrying the installer to a Windows 7 SP1 machine and reading the window, and any
further claim about Windows 7 has to be earned the same way.
