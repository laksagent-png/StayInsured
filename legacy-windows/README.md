# The Windows 7 probe

StayInsured needs Windows 10 version 1803 or newer, because WebView2, the Rust
standard library and Tailwind 4 each rule out Windows 7, 8 and 8.1 on their own.
Reaching those machines means a parallel edition built on Electron 22, the last
release that supports them.

This directory is not that edition. It is the one experiment that decides whether
the edition is worth building, and nothing more.

## What it answers

| Question | Why it decides anything |
| --- | --- |
| Does Electron 22 start on Windows 7? | Nothing else matters if the shell will not run |
| Does the `better-sqlite3` native module load? | A native module has to match Electron's ABI, and prebuilt binaries for this combination may no longer exist |
| Does the app's real schema apply to a plain SQLite file? | The three `.sql` files in `src-tauri/src/db/schema` are the part a parallel edition reuses rather than rewrites |
| Which modern CSS does this Chromium understand? | It confirms how much of Tailwind 4 needs compiling down for Chromium 108 |

The schema is read from `src-tauri/src/db/schema` rather than copied here, so the
probe cannot pass against a schema the app has since moved on from.

## Running it

```bash
cd legacy-windows
npm install
npm start              # the window
npm run probe          # the same checks, printed, no window
```

The window lists each check as PASS or FAIL and saves the same report as
`probe-report.json` in the app's data folder, so a run on someone else's machine
can be sent back as a file rather than described. `npm run probe` prints the same
result and exits non-zero on a failure, which is how the build machine checks it.

`.npmrc` is what makes the install work. A native module has to match Electron's
ABI rather than the ABI of whatever Node is on the machine, so it pins
`runtime`, `target` and `disturl`. Without it, `better-sqlite3` builds against
local Node headers and either fails outright or produces a binary Electron cannot
load.

## Building the installer

```bash
npm run package        # dist/StayInsured-Win7-Probe-0.0.1.exe
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

## What it cannot tell you

GitHub's runners start at Windows Server 2019, so CI proves only that the
installer builds. The gate itself is answered by running the installer on a
Windows 7 SP1 virtual machine and reading the window.

It also says nothing about the ~7,400 lines of Rust a parallel edition would have
to reimplement, or about the drift between two implementations of renewal chains
and the reminder outbox. Those are costs to accept, not questions to test.
