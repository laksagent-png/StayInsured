# Documentation

StayInsured is a desktop client-and-policy manager for an insurance agency. It
runs offline on macOS and Windows, keeps the whole book in one SQLCipher-encrypted
database on the user's own machine, and is built as a Tauri 2 app — a Rust core
with a React interface.

## Where to look

| Document | Audience | Covers |
| --- | --- | --- |
| [README](../README.md) | Agents using the app | Installing, first run, the seven screens, importing a spreadsheet, working renewals, backups |
| [HOW-TO](HOW-TO.md) | Agents using the app | Every operation with screenshots: setup, import, renewals, clients, policies, insurers, settings |
| [DEVELOPER](../DEVELOPER.md) | Anyone building it | Requirements, running, testing, cutting a release, code layout |
| [DESIGN](DESIGN.md) | Anyone changing it | Architecture, security model, renewal-chain and status design, import pipeline, error model, what is deliberately unbuilt |
| [API](API.md) | Anyone calling the core | All 50 Tauri commands, arguments, return types, error kinds, settings keys |
| [DATA-MODEL](DATA-MODEL.md) | Anyone touching the schema | Tables, domains, invariants, the `policy_overview` view, migration policy |

## The short version

- **One process, one machine, no network.** No account, no backend, no sync.
- **The password is the only key.** Argon2id stretches it into the SQLCipher key;
  neither the password nor the key is stored unless the user opts into the OS
  keychain.
- **Renewals never overwrite.** Each policy year is its own row in a chain, which
  is why the history is trustworthy.
- **Status follows the calendar.** Expired and lapsed are recalculated, not typed
  in.
- **Import assumes the file is wrong.** A dry run does the whole pass and rolls
  back; a real run isolates every row in a savepoint.

## Keeping these current

`.cursor/rules/` holds the rules that tell an agent which document a given code
change affects, and how these documents are written. The short version: they
describe the system as it is now, in the present tense, with no changelogs or
"recently added" framing.

The how-to guide is held to that by two commands:

```bash
npm run docs:screenshots   # re-photograph every screen from the running app
npm run docs:check         # fail if a route, control or screenshot is undocumented
```
