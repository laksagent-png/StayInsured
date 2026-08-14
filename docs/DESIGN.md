# Design

How StayInsured is built and why. This describes the application as it stands;
the command contract is specified in [API.md](API.md) and the database in
[DATA-MODEL.md](DATA-MODEL.md).

## What the design has to satisfy

StayInsured is used by one insurance agent, on one machine, to hold their entire
book of business. Four constraints follow from that and they decide almost every
choice below.

- **The data is confidential and the machine is not a server.** A laptop gets
  lost. The book is therefore encrypted at rest, and the key exists only while
  the app is unlocked.
- **There is no network.** No account, no sync, no backend to keep running. The
  app is useful on a train.
- **History is the product.** An agent needs to know what a client paid three
  years ago and when cover actually ran. Nothing that represents a policy year
  is ever overwritten.
- **The existing book arrives as a spreadsheet.** Onboarding means reading
  somebody's real, messy Excel file without them retyping it or losing rows.

## Shape of the system

One process, three layers, one bridge.

```mermaid
flowchart TB
    subgraph web["Webview — React + TypeScript"]
        pages["pages/ — one file per screen"]
        apits["lib/api.ts — the only invoke site"]
        pages --> apits
    end
    apits -->|"Tauri invoke"| cmds
    subgraph rust["Rust core"]
        cmds["commands.rs — the command surface"]
        repo["repo/ — one module per entity, owns the SQL"]
        io["importer.rs · exporter.rs · vault.rs"]
        db["db/ — SQLCipher connection + migrations"]
        cmds --> repo
        cmds --> io
        repo --> db
        io --> db
    end
    db --> file[("stayinsured.db — encrypted")]
```

The rules that keep this honest:

- **The interface never writes SQL.** It calls commands; commands call
  repositories; repositories own the queries. Adding a screen means adding a
  command and a page, and does not touch the database layer.
- **`src/lib/api.ts` is the only place that calls `invoke`.** Every screen goes
  through it, so the command surface has exactly one typed definition on the
  frontend and errors are normalised in one function.
- **Commands are thin.** They resolve the unlocked database, choose a
  transaction or a read, and delegate. Business rules live in `repo/` and in the
  importer, where they are reachable from tests without a window.

## Process lifecycle

The app is a tray-resident background application, not a document window.

- Closing the window hides it. `on_window_event` intercepts `CloseRequested`,
  cancels the close and hides the webview, so the process survives to do
  scheduled work. Quitting is deliberate, from the tray menu.
- The tray menu offers Open, **Lock now** and Quit. Locking from the tray drops
  the database handle without quitting.
- Launched with `--background` (how the autostart plugin starts it at login) the
  window stays hidden and the app goes straight to the tray.
- Startup order in `run()`: tracing, plugins, resolve `AppPaths` and create the
  data directories, register `AppState`, build the tray, register commands.

Everything the app writes lives under one directory, so a backup or a move to a
new machine is a single folder copy.

| Platform | Data directory |
| --- | --- |
| macOS | `~/Library/Application Support/com.stayinsured.app` |
| Windows | `%APPDATA%\com.stayinsured.app` |
| Linux | `~/.local/share/com.stayinsured.app` |

It holds `stayinsured.db`, `vault.json`, `documents/`, `backups/` and `logs/`.

## Security model

The password is the only key to the book, and it is never stored.

```mermaid
flowchart LR
    pw["Password"] --> argon["Argon2id<br/>64 MiB · 3 passes<br/>salt from vault.json"]
    argon --> key["32-byte key (hex)"]
    key --> cipher["SQLCipher<br/>PRAGMA key = x'…'"]
    key -.->|"only if 'remember on this device'"| ring["OS keychain"]
    cipher --> db[("stayinsured.db")]
```

- **`vault.json` holds no secret.** It carries the KDF version, salt and cost
  parameters — exactly what is needed to turn the password back into the key,
  which is why it can be read before anything is decrypted.
- **The key goes to SQLCipher in raw form.** The password has already been
  stretched with Argon2id, so SQLCipher's own KDF would only add cost without
  adding strength. `apply_key` rejects anything that is not 64 hex characters.
- **A wrong password is detected by reading `sqlite_master`.** SQLCipher reports
  a wrong key as a corruption-shaped error, so `verify_readable` translates
  `NotADatabase` and `DatabaseCorrupt` into `bad_password` rather than leaking a
  scary internal error.
- **Locked is a real state, not a UI flag.** `AppState` holds
  `RwLock<Option<Arc<Database>>>`. Before unlock there is no connection and no
  key in memory, so every data command fails with `locked` by construction
  rather than by remembering to check.
- **The `users` row keeps a separate Argon2 password hash.** It is independent of
  the database key so that adding staff accounts later does not require
  re-keying the database.
- **"Remember on this device" is opt-in and reversible.** The derived key goes to
  the OS keychain under service `com.stayinsured.app`, account `database-key`.
  `forget_device` deletes it.
- **Changing the password re-keys the database and can be rolled back.**
  `change_password` verifies the current password, runs `PRAGMA rekey`, then
  writes the new `vault.json`. If that write fails the database is re-keyed back
  to the old key, because a database whose key no longer matches its vault file
  is unopenable.

Losing the password with no keychain entry means the data is unrecoverable. That
is the intended property of encrypting it, and the first-run screen says so.

### Backups

`backup_now` uses `VACUUM INTO`, not the SQLite online backup API, which
SQLCipher rejects. The result is a compacted copy encrypted with the same key,
taken safely while the app is running. Backups are named
`stayinsured-YYYYMMDD-HHMMSS.db`, mirrored to `backup_dir` when that setting
points at an existing directory, and pruned to `backup_retention` (14 by
default). Because they carry the same encryption, a cloud-synced folder is a
reasonable place to keep them.

## Data layer

**One encrypted connection behind a mutex.** A desktop app has a single writer
and short-lived reads, so a connection pool buys nothing and would complicate
SQLCipher key handling. `Database` exposes exactly two ways in:

- `with(|conn| …)` for reads.
- `with_tx(|tx| …)` for anything that writes, committing on `Ok` and rolling
  back on `Err`.

Every write command uses `with_tx`, so a partially applied multi-statement
change cannot survive an error.

Connection pragmas on open: `journal_mode = WAL`, `foreign_keys = ON`,
`busy_timeout = 5000`, `synchronous = NORMAL`.

**Migrations are append-only.** `MIGRATIONS` is an ordered list of
`(version, sql)` compiled in with `include_str!`, applied inside one transaction
and tracked in `PRAGMA user_version`. A shipped entry is never edited; a change
is a new numbered file. `session_state.schemaVersion` reports the latest version
so the interface can see what it is talking to.

**Query construction is allow-listed.** `query::Conditions` accumulates WHERE
fragments with their bound values; values are always bound, never interpolated.
Sort keys resolve through per-repository `SORTABLE` tables and `IN` lists are
filtered against the known enum values, so a client-supplied sort or category
cannot reach the SQL text. Pagination clamps page size to 1–500 and defaults to
50.

## Domain design

### Renewal chains

The central modelling decision: **a policy row is never mutated on renewal.**
Each policy year is its own row, linked backwards by `previous_policy_id` and
sharing a `chain_id` across the whole lineage.

```mermaid
flowchart LR
    y1["Year 1<br/>status: renewed<br/>₹24,500"] --> y2["Year 2<br/>status: renewed<br/>₹27,000"] --> y3["Year 3<br/>status: active<br/>₹29,400"]
    y1 -.->|"same chain_id"| y3
```

This makes the annual record permanent, turns renewal and lapse reporting into a
straight query instead of an audit-trail reconstruction, and gives the
`is_renewed` flag a precise definition: a policy is renewed when a row exists
whose `previous_policy_id` points at it.

`renew` carries forward everything the caller does not restate — frequency,
payment mode, nominee, vehicle number, commission, and the covered members —
defaults the new term to the day after expiry plus a year minus a day, copies
the `policy_members` rows, and marks the expiring year `renewed`.

Because `(insurer_id, policy_number)` is unique, **a renewal needs a policy
number that differs from the expiring year's** when the insurer is the same. The
renewal dialog pre-fills last year's number and says insurers usually issue a
fresh one; leaving it unchanged returns a `conflict`.

### Status is derived from the calendar, not typed in

`sync_statuses` reconciles every policy against today in four passes, in order:

1. Anything with a successor becomes `renewed`, whatever it said before.
2. `active` past its expiry date becomes `expired`.
3. `expired` for more than 30 days (`LAPSE_GRACE_DAYS`) becomes `lapsed`.
4. `expired` or `lapsed` with an expiry date in the future returns to `active`.

Passes 1 and 4 are the correction paths: they mean a mistyped date or a
back-dated edit heals itself instead of leaving a wrong status behind.
`cancelled` is only ever set by hand and is never overwritten.

It runs on every unlock, after every real import, and on demand from
**Recalculate** on the renewals screen, so "expiring" and "lapsed" always mean
what they say.

### One view feeds every list

`policy_overview` joins policy, client, insurer and product and adds two
computed columns: `days_to_expiry` (live, against local midnight) and
`is_renewed`. Every grid, filter, dashboard tile and export reads from it, so
they cannot disagree about what "expiring in 30 days" means. `POLICY_COLUMNS`
pins the column order that `Policy::from_row` expects.

### Client identity

Client codes are `CL-00001`, allocated by taking the maximum numeric suffix
matching `CL-[0-9]*` and adding one, so a manually entered code never blocks the
sequence. Deduplication resolves in a fixed order — client code, then email,
then phone, then name — and the importer depends on that order.

Archiving is the soft option and the default one offered in the UI; deleting a
client cascades to their policies.

## Import pipeline

Import is the highest-risk operation in the app: it takes an unknown file and
writes to the whole book. The design assumes the file is wrong.

```mermaid
flowchart LR
    file["xlsx · xls · csv · tsv"] --> read["read_sheet<br/>flatten cells to strings"]
    read --> suggest["suggest_mapping<br/>synonyms, then containment"]
    suggest --> review["Operator confirms the mapping"]
    review --> dry["Dry run<br/>full pass, then ROLLBACK"]
    dry --> real["Real run<br/>row savepoints, then COMMIT"]
    real --> sync["sync_statuses"]
```

- **Everything happens in one transaction.** A dry run does the entire pass and
  rolls back, so the report is what a real run would do — not a guess. A real
  run lands completely or not at all.
- **Each row is its own savepoint.** Without this, a row that creates a client
  and then fails on the policy would leave the half-built client behind. A
  failed row is rolled back to the savepoint and its report counters are wound
  back with it.
- **Four fields are mandatory**: client name, policy number, insurer, expiry
  date. `run` refuses before touching data if any of them is unmapped, or if the
  mapping names a column the file does not have.
- **Blanks fill, values never overwrite.** `fill_client_gaps` uses
  `COALESCE(NULLIF(…))`, so a second import can add missing phone numbers
  without erasing better data.
- **Header matching is two-pass.** Exact synonym match first across all fields,
  then containment, and each column is claimed once — so
  "Policy Expiry Date (DD/MM/YYYY)" lands on `expiryDate` without stealing the
  column that `startDate` needs.
- **Real-world values are normalised, not rejected.** Day-first dates, Excel
  serials, `₹10,00,000`, `Rs. 24,500.50`, "Mediclaim" → health, "two wheeler" →
  motor, `+91 98765-43210` → `+919876543210`. A malformed email is dropped and
  reported rather than sinking the row.
- **Insurers and plans are resolved, not duplicated.** `find_or_create` matches
  on name or short code, then on a contained name, before creating anything, so
  "HDFC Ergo" does not become a third spelling of an insurer already on file.
- **The issue list is capped at 300.** A broken file produces a readable report,
  not fifty thousand lines. Every real run is recorded in `import_batches` with
  its mapping and its errors in `import_errors`.

Export mirrors it: one column table paired with value extractors drives both
`.xlsx` and `.csv`, so the two formats cannot drift. Numbers are written as
numbers so totals and sorting work in Excel, and an unsupported extension is
refused with a clear message.

## Interface architecture

- **React 18 + Vite + Tailwind 4**, one file per screen under `src/pages/`,
  shared widgets in `src/components/`.
- **TanStack Query owns all server state.** No global store. Reads are cached
  with a 15-second stale time, `refetchOnWindowFocus` is off because refetching
  on every focus makes a desktop app feel jumpy, and `retry` is off because a
  local database failure will not fix itself.
- **`HashRouter`**, because the app is served from a file-based webview.
- **`App.tsx` is the session gate.** It queries `session_state` and renders
  either `LockScreen` or the routed shell. Lock state is therefore driven by the
  backend, not by frontend routing.
- **`src/lib/types.ts` mirrors `src-tauri/src/models.rs`.** Rust serialises with
  `#[serde(rename_all = "camelCase")]`, so the two files are the same shape in
  two languages and must be edited together.

Window and permissions are deliberately narrow: 1440×900 with a 1024×680
minimum, a CSP of `default-src 'self'`, the asset protocol scoped to
`$APPDATA/documents/**`, and a capability file granting only dialog,
notification, opener, autostart and window dragging.

## Error model

`AppError` is one enum with a `kind()` tag, serialised to the interface as
`{ kind, message }`. The tag lets the UI react to a class of failure without
string-matching messages; the message is written for the person reading it, not
for a log file.

| `kind` | Meaning |
| --- | --- |
| `locked` | No unlocked database. The UI shows the lock screen. |
| `bad_password` | Wrong password, including a wrong SQLCipher key. |
| `already_initialised` | `setup` called on an installation that has a vault. |
| `validation` | The input is wrong and the message says how. |
| `not_found` | The named entity does not exist. |
| `conflict` | A uniqueness or in-use rule refuses the change. |
| `internal` | Database, file, serialisation or spreadsheet failure. |

Constraint violations are translated at the repository boundary, so a duplicate
policy number reads "That policy number already exists for this insurer. Use
Renew to add the next year." instead of surfacing SQLite text. An insurer that
still carries policies cannot be deleted at all — deactivating is the intended
way to retire one.

## Testing strategy

The data layer holds the money and the renewal dates, so that is where the tests
are. `src-tauri/src/tests.rs` exercises it end to end against a real encrypted
database in a temporary directory, with no window:

- migrations and seed apply, and the 60/30/15/7/1 reminder ladder is active
- a wrong key is reported as `bad_password`
- client codes increment and deduplication resolves in the documented order
- renewal builds a chain, carries values forward and preserves last year's
  premium
- statuses follow the calendar and the dashboard agrees with them
- a duplicate policy number for one insurer is refused
- a member from another client cannot be attached to a policy
- a messy spreadsheet maps correctly, a dry run writes nothing, and re-importing
  updates in place instead of duplicating
- an unmapped required field refuses the import
- export writes both formats and refuses a third
- a backup reopens with the same key
- Indian date and money formats parse

Run them with `cd src-tauri && cargo test --lib`. CI runs the same command on
macOS before building any installer, so a release is never cut on a failing data
layer. The frontend is covered by `tsc --noEmit`; there is no UI test suite.

## Build and release

Vite builds the frontend into `dist/`, which Tauri embeds. `rusqlite` bundles
SQLCipher and vendors OpenSSL, which is why the Windows job checks for Perl and
NASM. The release profile uses LTO, `opt-level = "s"`, symbol stripping and
`panic = "abort"`.

Pushing a `v*` tag publishes a GitHub release with a universal macOS `.dmg` and
Windows `.msi` and `.exe`; running the workflow by hand builds the same
installers and attaches them to the run instead. The workflow refuses to build
when the tag and `tauri.conf.json` disagree, so installers cannot ship under the
wrong version. Releases are unsigned, and both installers therefore warn on
first launch.

## Built, and deliberately not built yet

Working today: clients and insured members, policies with renewal chains, the
renewals desk, the dashboard, insurers and plans, spreadsheet import with a dry
run, export, settings, encrypted backups, lock and unlock.

The schema already carries tables that no screen writes to yet:
`premium_payments`, `commissions`, `claims`, `documents`, `email_templates`,
`reminder_rules`, `notification_log`, `audit_log` and `saved_views`. They exist
because their shape affects the design of what is built — `notification_log`'s
`UNIQUE (rule_id, policy_id, policy_period)` is what will make a reminder fire
exactly once per policy year no matter how often the scheduler sweeps or the app
restarts, and the tray-resident lifecycle exists so that sweep has somewhere to
run.

Reminder sending is the notable gap: the settings, templates and the 60/30/15/7/1
rule ladder are seeded and editable, but nothing sends mail. The renewals screen
with **Copy emails** is the working substitute. Reports, document storage, claims
tracking and multi-user logins are the other unbuilt pieces named in the
[README](../README.md).
