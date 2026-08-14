# API specification

StayInsured has no HTTP API. Its API is the set of Tauri commands the Rust core
exposes to the webview — 50 commands that are the only way the interface reaches
data.

The contract is defined in four files that must always agree:

| File | Role |
| --- | --- |
| `src-tauri/src/commands.rs` | Command implementations — the source of truth |
| `src-tauri/src/lib.rs` | `generate_handler!` registration; an unregistered command does not exist |
| `src-tauri/src/models.rs` | Request and response types |
| `src/lib/api.ts` | Typed frontend wrapper, mirrored by `src/lib/types.ts` |

## Calling convention

The frontend calls through `api` in `src/lib/api.ts`, never `invoke` directly:

```ts
import { api } from "@/lib/api";

const page = await api.listPolicies({ expiringWithinDays: 30, page: 1 });
```

- **Command names are `snake_case`; arguments and fields are `camelCase`.** Tauri
  maps `clientId` to the `client_id` parameter, and every Rust model carries
  `#[serde(rename_all = "camelCase")]`.
- **Arguments are named, not positional.** `invoke("get_client", { id })`.
- **Struct arguments are wrapped in their parameter name.** A filter is passed as
  `{ filter: {…} }` and an input as `{ input: {…} }`, because that is the
  parameter name on the Rust side.
- **Optional arguments accept `null`.** `api.listProducts()` sends
  `insurerId: null`.

## Errors

Every fallible command rejects with `{ kind, message }`. `api.ts` restores that
into an `ApiError` with a `kind` field, so callers switch on the tag and show the
message.

```ts
try {
  await api.createPolicy(input);
} catch (err) {
  if (err instanceof ApiError && err.kind === "conflict") {
    // the policy number is taken — offer Renew instead
  }
}
```

| `kind` | Meaning | Typical handling |
| --- | --- | --- |
| `locked` | No unlocked database | Send the user to the lock screen |
| `bad_password` | Wrong password or wrong encryption key | Show it on the password field |
| `already_initialised` | `setup` called where a vault already exists | Switch to unlock |
| `validation` | Input rejected; the message says why | Show it on the form |
| `not_found` | The entity does not exist | Refetch the list |
| `conflict` | A uniqueness or in-use rule refuses the change | Show the message; it explains the alternative |
| `internal` | Database, file, serialisation or spreadsheet failure | Show the message as a toast |

**Any command that reads or writes data returns `locked` until the session is
unlocked.** These commands work while locked: `session_state`, `setup`,
`unlock`, `unlock_with_keychain`, `lock`, `forget_device`, `category_options`,
`import_fields`, `preview_import` and `write_import_template`.

## Conventions

- **Ids** are `i64` / `number`. Create commands return the new id.
- **Dates** are ISO `YYYY-MM-DD` strings. Date fields on inputs also accept the
  formats `util::parse_date` understands (day-first, `31-Mar-2027`, Excel
  serials) and are stored normalised. Timestamps are SQLite
  `YYYY-MM-DD HH:MM:SS` in UTC.
- **Money and rates** are `f64` / `number`, unformatted. Currency is a
  presentation setting.
- **Blank strings become `null`.** Optional text is trimmed and empty values are
  stored as `NULL`, so unique indexes and the "missing email" filter behave
  predictably.
- **Lists return `Page<T>`** — `{ rows, total, page, pageSize }`. Page size
  defaults to 50 and is clamped to 1–500; `page` is 1-based.
- **Sorting** takes a key from a per-entity allow-list plus `descending`. An
  unknown key silently falls back to the default rather than failing.
- **Filters ignore what they do not recognise.** Unknown categories or statuses
  are dropped from the `IN` list, which is what makes the filters
  injection-proof.

## Session

| Command | Arguments | Returns |
| --- | --- | --- |
| `session_state` | — | `SessionState` |
| `setup` | `password: string`, `displayName?: string`, `remember?: boolean` | `SessionState` |
| `unlock` | `password: string`, `remember?: boolean` | `SessionState` |
| `unlock_with_keychain` | — | `SessionState` |
| `lock` | — | `SessionState` |
| `forget_device` | — | `SessionState` |
| `change_password` | `current: string`, `replacement: string` | `void` |

```ts
interface SessionState {
  initialised: boolean;    // vault.json exists
  unlocked: boolean;       // a decrypted connection is open
  canUseKeychain: boolean; // a key is stored in the OS keychain
  schemaVersion: number;   // latest applied migration
  dataDir: string;         // absolute path to the data directory
}
```

**`setup`** creates the vault parameters, the encrypted database and the owner
row, and seeds `provider_name` from `displayName` (default `"Owner"`).
`vault.json` is written last, so an interrupted first run still counts as fresh.
Errors: `already_initialised`, `validation` (passwords must be at least 8
characters).

**`unlock`** derives the key, opens the database, verifies the stored password
hash, stamps `last_login_at` and runs `sync_statuses`. Errors: `bad_password`,
`internal` when there is no vault to load.

**`unlock_with_keychain`** uses the key held in the OS keychain. Errors:
`locked` when no key is stored, `bad_password` when the stored key no longer
matches.

**`change_password`** verifies `current`, re-keys the database, rewrites the
vault and updates the stored hash, refreshing the keychain entry if one exists.
If the vault cannot be written the database is re-keyed back. Errors: `locked`,
`validation`, `bad_password`.

## Dashboard and lookups

| Command | Arguments | Returns |
| --- | --- | --- |
| `load_dashboard` | — | `Dashboard` |
| `category_options` | — | `LookupItem[]` |
| `client_cities` | — | `string[]` |

`Dashboard` carries the headline counts (`totalClients`, `activeClients`,
`activePolicies`, `expiringThisWeek`, `expiringThisMonth`, `expiredUnrenewed`,
`premiumUnderManagement`, `commissionExpected`, `clientsWithoutEmail`), the
renewal-desk `buckets` (Overdue, 0-7, 8-15, 16-30, 31-60, 61-90 days), a
`byCategory` breakdown of active policies, up to 12 `upcoming` policies expiring
within 45 days, and up to 8 `recentlyLapsed`.

Overdue buckets count only unrenewed, non-cancelled policies; forward buckets
count only `active` ones.

`category_options` returns each category with its display label and the enum key
in `secondary`. It needs no database.

## Clients

| Command | Arguments | Returns |
| --- | --- | --- |
| `list_clients` | `filter: ClientFilter` | `Page<Client>` |
| `get_client` | `id: number` | `Client` |
| `create_client` | `input: ClientInput` | `number` |
| `update_client` | `id: number`, `input: ClientInput` | `void` |
| `set_client_archived` | `id: number`, `archived: boolean` | `void` |
| `delete_client` | `id: number` | `void` |
| `next_client_code` | — | `string` |

`ClientFilter`: `search`, `city`, `state`, `category`, `includeArchived`,
`missingEmail`, `sort`, `descending`, `page`, `pageSize`. Archived clients are
excluded unless `includeArchived` is true. `search` runs against the FTS5 index
over name, email, phone, client code and PAN, falling back to a `LIKE` scan when
the term has no searchable tokens. Sort keys: `name` (default), `code`, `city`,
`created`, `updated`, `policies`, `nextExpiry`.

`ClientInput` requires `fullName`; everything else is optional. `clientCode` is
allocated as the next `CL-000NN` when omitted. Names are title-cased without
mangling initials, phones are reduced to digits with an optional leading `+`,
PAN and GSTIN are upper-cased, and email is rejected if malformed.

`Client` responses add `activePolicies`, `totalPolicies` and `nextExpiry`.

**`delete_client`** cascades to that client's policies and members.
`set_client_archived` is the reversible alternative and what the UI offers first.

Errors: `validation` (missing name, bad email, bad date of birth), `conflict`
(client code in use), `not_found`.

## Insured members

| Command | Arguments | Returns |
| --- | --- | --- |
| `list_members` | `clientId: number` | `InsuredMember[]` |
| `create_member` | `input: MemberInput` | `number` |
| `update_member` | `id: number`, `input: MemberInput` | `void` |
| `delete_member` | `id: number` | `void` |

`MemberInput` requires `clientId` and `fullName`. `relationship` is normalised
onto `self | spouse | son | daughter | father | mother | other` — "wife" and
"husband" become `spouse`, anything unrecognised becomes `other`. Lists come back
ordered self, spouse, then everyone else by name.

A member can only be attached to a policy belonging to their own client;
`create_policy` and `update_policy` silently ignore ids from another client.

## Insurers and plans

| Command | Arguments | Returns |
| --- | --- | --- |
| `list_insurers` | `includeInactive?: boolean` | `Insurer[]` |
| `insurer_options` | — | `LookupItem[]` |
| `create_insurer` | `input: InsurerInput` | `number` |
| `update_insurer` | `id: number`, `input: InsurerInput` | `void` |
| `delete_insurer` | `id: number` | `void` |
| `list_products` | `insurerId?: number`, `includeInactive?: boolean` | `Product[]` |
| `create_product` | `input: ProductInput` | `number` |
| `update_product` | `id: number`, `input: ProductInput` | `void` |
| `delete_product` | `id: number` | `void` |

Insurer names are unique; short codes are upper-cased. `insurer_options` returns
active insurers ordered by how many policies they carry, so the pickers put the
ones actually used first. A fresh install ships 25 seeded Indian insurers.

`ProductInput` requires `insurerId`, `name` and a valid `category`; a plan name
is unique per insurer. Both responses include `policyCount`.

**`delete_insurer` refuses while policies point at it** and returns `conflict`
naming the count — deactivating with `isActive: false` is the intended way to
retire one.

## Policies

| Command | Arguments | Returns |
| --- | --- | --- |
| `list_policies` | `filter: PolicyFilter` | `Page<Policy>` |
| `get_policy` | `id: number` | `Policy` |
| `policy_chain` | `id: number` | `Policy[]` |
| `policy_member_ids` | `id: number` | `number[]` |
| `create_policy` | `input: PolicyInput` | `number` |
| `update_policy` | `id: number`, `input: PolicyInput` | `void` |
| `renew_policy` | `input: RenewalInput` | `number` |
| `set_policy_status` | `id: number`, `status: string` | `void` |
| `delete_policy` | `id: number` | `void` |
| `refresh_statuses` | — | `number` |

`PolicyFilter`: `search` (policy number, client name, client code, vehicle
number), `clientId`, `insurerId`, `productId`, `categories[]`, `statuses[]`,
`expiryFrom`, `expiryTo`, `expiringWithinDays`, `minPremium`, `maxPremium`,
`city`, `latestOnly`, `unrenewedOnly`, `sort`, `descending`, `page`, `pageSize`.

- `latestOnly` keeps only the most recent year in each renewal chain.
- `unrenewedOnly` keeps expired or lapsed policies with no successor — the
  chase list.
- `expiringWithinDays` counts forward from today only; it never includes overdue
  policies.
- Sort keys: `expiry` (default), `days`, `client`, `premium`, `sumInsured`,
  `insurer`, `category`, `policyNumber`, `created`.

`PolicyInput` requires `policyNumber`, `clientId`, `insurerId`, `category`,
`startDate` and `expiryDate`; expiry must be after start. `status` defaults to
`active` on create and is left unchanged on update when omitted.
`premiumFrequency` defaults to `annual`. Vehicle numbers are upper-cased.
`memberIds` replaces the covered-member set; omitting it on update leaves the set
alone.

`Policy` responses are read from the `policy_overview` view, so they carry the
client and insurer names alongside `daysToExpiry`, `isRenewed`, `chainId`,
`policyYear` and `previousPolicyId`.

**`policy_chain`** returns every year of the chain the policy belongs to, oldest
first.

**`renew_policy`** appends the next year rather than editing the current one. It
takes `policyId` plus optional `policyNumber`, `startDate`, `expiryDate`,
`sumInsured`, `premiumAmount`, `gstAmount`, `commissionRate`,
`commissionExpected` and `notes`. Anything omitted is carried forward from the
policy being renewed; the term defaults to the day after expiry through a year
minus a day; covered members are copied; the expiring year becomes `renewed`.

Because `(insurerId, policyNumber)` is unique, **supply a `policyNumber` that
differs from the expiring year's** — reusing it returns `conflict`.

**`set_policy_status`** accepts `active | expired | renewed | lapsed |
cancelled`. Note that `sync_statuses` recalculates everything except
`cancelled`, so a hand-set date-driven status will be corrected on the next
unlock, import or `refresh_statuses`.

**`refresh_statuses`** returns the number of rows touched.

Errors: `validation` (missing number, unknown category or status, expiry not
after start, non-existent client or insurer), `conflict` (duplicate policy
number for the insurer), `not_found`.

## Import and export

| Command | Arguments | Returns |
| --- | --- | --- |
| `import_fields` | — | `ImportFieldInfo[]` |
| `preview_import` | `path: string`, `sheet?: string` | `ImportPreview` |
| `run_import` | `options: ImportOptions` | `ImportReport` |
| `write_import_template` | `path: string` | `string` |
| `export_policies` | `filter: PolicyFilter`, `path: string` | `number` |
| `export_clients` | `filter: ClientFilter`, `path: string` | `number` |

Accepted inputs: `.xlsx`, `.xls`, `.csv`, `.tsv`, `.txt`. The first row is the
header; fully blank rows are dropped.

**`preview_import`** returns the sheet names, chosen sheet, headers, up to 8
sample rows, the total row count, a `suggestedMapping` of field key → header
name, and the headers it could not place.

**`ImportOptions`**:

```ts
interface ImportOptions {
  path: string;
  sheet?: string | null;
  mapping: Record<string, string>;  // field key -> header name
  defaultCategory?: string | null;  // used when the row implies none; "other"
  updateExisting?: boolean;         // default true
  dryRun?: boolean;                 // default false
}
```

`mapping` must cover **`fullName`, `policyNumber`, `insurerName` and
`expiryDate`**; anything less returns `validation` before data is touched, as
does naming a column the file does not contain. When `startDate` is absent it is
back-dated 364 days from the expiry date.

**`dryRun: true` performs the entire import and rolls it back**, so the report is
exactly what a real run would do. A real run runs `sync_statuses` afterwards and
records the batch in `import_batches`.

`ImportReport` counts `totalRows`, `policiesInserted`, `policiesUpdated`,
`clientsCreated`, `clientsUpdated`, `insurersCreated`, `skipped` and `failed`,
with up to 300 `issues` carrying a 1-based spreadsheet `row` and a message.
A failed row is rolled back whole; nothing half-created survives it.

**`write_import_template`** writes an `.xlsx` with every recognised column and
one example row, and returns the path.

**Export** commands take the same filters as the matching list command, ignore
pagination, and write `.xlsx` or `.csv` chosen by the file extension. Anything
else returns `validation`. The return value is the number of rows written.

## Settings and maintenance

| Command | Arguments | Returns |
| --- | --- | --- |
| `get_settings` | — | `Record<string, string>` |
| `save_settings` | `values: Record<string, string>` | `void` |
| `backup_now` | — | `string` |
| `reveal_data_dir` | — | `void` |

Settings are a string key/value store; `save_settings` upserts only the keys it
is given. `backup_now` writes an encrypted snapshot, mirrors it to `backup_dir`
when that points at an existing directory, prunes to `backup_retention`, and
returns the path of the local copy.

### Settings keys

| Key | Default | Used for |
| --- | --- | --- |
| `provider_name` | `My Insurance Agency` | Agency name shown in the app |
| `provider_email` / `provider_phone` / `provider_address` | empty | Agency contact details |
| `currency` | `INR` | Money formatting |
| `locale` | `en-IN` | Number and date formatting |
| `date_format` | `dd/MM/yyyy` | Date display |
| `expiring_soon_window` | `30` | Days ahead that count as expiring soon |
| `desktop_alerts` | `true` | Desktop notification of the day's expiries |
| `backup_dir` | empty | Extra folder each backup is copied to |
| `backup_retention` | `14` | Local backups kept |
| `reminders_enabled` | `false` | Reserved — reminder sending is not built |
| `reminder_send_time` | `09:00` | Reserved |
| `daily_send_cap` | `400` | Reserved |
| `digest_enabled` | `true` | Reserved |
| `dry_run` | `true` | Reserved |
| `smtp_host` / `smtp_port` / `smtp_username` / `smtp_from_name` / `smtp_from_email` / `smtp_encryption` | empty, `587`, `starttls` | Reserved |

Keys marked reserved are stored and editable but nothing reads them yet; see
[DESIGN.md](DESIGN.md).

## Enumerations

| Enum | Values |
| --- | --- |
| Category | `health`, `life`, `motor`, `travel`, `home`, `personal_accident`, `critical_illness`, `other` |
| Policy status | `active`, `expired`, `renewed`, `lapsed`, `cancelled` |
| Relationship | `self`, `spouse`, `son`, `daughter`, `father`, `mother`, `other` |
| Premium frequency | `annual`, `half_yearly`, `quarterly`, `monthly`, `single` |
| Gender | `male`, `female`, `other` |

## Adding a command

All five steps are required; missing the second leaves a command that compiles
and cannot be called.

1. Implement it in `src-tauri/src/commands.rs`, taking `State<AppState>` and
   using `state.db()?` — `with_tx` for writes, `with` for reads. Keep the logic
   in `repo/`.
2. Register it in `generate_handler!` in `src-tauri/src/lib.rs`.
3. Add or extend the types in `src-tauri/src/models.rs` with
   `#[serde(rename_all = "camelCase")]`.
4. Mirror those types in `src/lib/types.ts` and add the wrapper to the `api`
   object in `src/lib/api.ts`.
5. Document it here, in the right group, with its arguments, return value and
   error kinds.
