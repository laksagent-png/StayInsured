# Documentation

StayInsured is a desktop client-and-policy manager for an insurance agency. It
runs offline on macOS and Windows, keeps the whole book in one SQLCipher-encrypted
database on the user's own machine, and is built as a Tauri 2 app — a Rust core
with a React interface.

The documentation is in two halves. [`guide/`](guide/index.md) is written for
the agent running their book; [`technical/`](technical/) is written for whoever
is building the app.

## Using the app

| Document | Covers |
| --- | --- |
| [The agent's guide](guide/index.md) | Contents page for everything below |
| [Install and first run](guide/install-and-first-run.md) | Installing, creating the encrypted book, unlocking, locking |
| [Find your way around](guide/getting-around.md) | The eight screens, search, reading the dashboard |
| [Import your book](guide/import-your-book.md) | Every recognised column, the mapping, the dry run, failed rows |
| [Manage clients](guide/clients.md) | Adding, finding, editing, archiving, deleting, exporting |
| [Record a family](guide/families.md) | Linking relatives, and who a floater covers |
| [Keep the paperwork](guide/documents.md) | Attaching scans to a client or policy, and reading them back |
| [Manage policies](guide/policies.md) | The policy form field by field, filters, statuses |
| [Work the renewals](guide/renewals.md) | The urgency tabs, copy emails, recording a renewal, history |
| [Send the reminders](guide/reminders.md) | The rule ladder, writing the messages, the daily run, the outbox |
| [Insurers and plans](guide/insurers-and-plans.md) | Keeping one company recorded one way |
| [Settings](guide/settings.md) | Agency details, password, reminders, the mail server |
| [Backups and your data](guide/backups-and-data.md) | Taking, restoring and moving the book |
| [Reference](guide/reference.md) | Categories, statuses, shortcuts, questions |

## Building the app

| Document | Audience | Covers |
| --- | --- | --- |
| [README](../README.md) | Anyone | What the app is, installing it, the short version of using it |
| [CHANGELOG](../CHANGELOG.md) | Anyone | What changed in each version. A user-visible change adds a line here as it is made |
| [DEVELOPER](../DEVELOPER.md) | Anyone building it | Requirements, running, testing, cutting a release, code layout |
| [DESIGN](technical/DESIGN.md) | Anyone changing it | Architecture, security model, renewal-chain and status design, import pipeline, error model, what is deliberately unbuilt |
| [API](technical/API.md) | Anyone calling the core | All 50 Tauri commands, arguments, return types, error kinds, settings keys |
| [DATA-MODEL](technical/DATA-MODEL.md) | Anyone touching the schema | Tables, domains, invariants, the `policy_overview` view, migration policy |

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

The guide is held to that by two commands:

```bash
npm run docs:screenshots   # re-photograph every screen from the running app
npm run docs:check         # fail if a route, control or screenshot is undocumented
```
