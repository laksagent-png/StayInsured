# API specification

StayInsured has no HTTP API. Its API is the set of Tauri commands the Rust core
exposes to the webview — 82 commands that are the only way the interface reaches
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
| `mail` | The mail server is unconfigured, unreachable or refused the message | Show the message on the mail settings, not as a queue failure |
| `internal` | Database, file, serialisation or spreadsheet failure | Show the message as a toast |

**Any command that reads or writes data returns `locked` until the session is
unlocked.** These commands work while locked: `session_state`, `setup`,
`unlock`, `unlock_with_keychain`, `lock`, `forget_device`, `category_options`,
`import_fields`, `preview_import`, `write_import_template`,
`template_placeholders` and `reveal_data_dir`.

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
  encrypted: boolean;      // always true here; see below
  schemaVersion: number;   // latest applied migration
  dataDir: string;         // absolute path to the data directory
}
```

**`encrypted`** is always `true` from this backend, which opens SQLCipher with a
key derived from the password. It is reported rather than assumed because the lock
screen and the security section of Settings promise the operator that their
database is encrypted, and those screens are shared with the Electron edition in
`legacy-windows/`, which serves the same commands over a plain SQLite file and
answers `false`. A backend that cannot keep the promise says so and the screens
print a warning instead.

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

**`lock`** drops the database handle and returns the locked `SessionState`. The
interface switches to that session rather than emptying its cache, which would
leave it holding an unlocked session it can never refetch.

The backend emits `session:locked`, carrying a `SessionState`, when **Lock now**
in the tray menu closes the book. Nothing in the interface asked for that, so it
listens and reacts as though it had called `lock` itself.

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
| `set_family_archived` | `id: number`, `archived: boolean` | `number` |
| `delete_client` | `id: number`, `scope?: DeleteScope` | `number[]` |
| `next_client_code` | — | `string` |

`ClientFilter`: `search`, `city`, `state`, `category`, `includeArchived`,
`includeFamily`, `missingEmail`, `kind`, `groupId`, `sort`, `descending`, `page`,
`pageSize`. Archived clients are excluded unless `includeArchived` is true.
`search` runs against the FTS5 index over name, email, phone, client code and
PAN, falling back to a `LIKE` scan when the term has no searchable tokens. Sort
keys: `name` (default), `code`, `city`, `created`, `updated`, `policies`,
`nextExpiry`, `group`.

`kind` narrows to `individual` or `company`, and a word outside that vocabulary
is dropped rather than passed to SQL, so an out-of-date screen shows the book
rather than nothing at all. **`groupId` is how a group's roster is read** — the
client list narrowed to one folder, with every filter and sort it already has,
rather than a second paged command that would drift from it.

**Dependents are excluded from browse but never from search.** A client with no
policy of their own who is named as somebody's relative is a dependent; the list
drops them unless `includeFamily` is true, and includes them whenever `search` is
non-empty regardless. The dashboard's people counts apply the same rule, so
`totalClients` and `clientsWithoutEmail` are counts of policyholders.

`ClientInput` requires `fullName`; everything else is optional. `clientCode` is
allocated as the next `CL-000NN` when omitted. Names are title-cased without
mangling initials, phones are reduced to digits with an optional leading `+`,
PAN, GSTIN and `registrationNo` are upper-cased, and email is rejected if
malformed.

`kind` is `individual` or `company`, and an omitted or unrecognised one is
`individual` — a payload that says nothing is describing a person, which is what
every client entered before companies existed was. A company carries
`contactPerson`, `contactDesignation` and `registrationNo` instead of a date of
birth and a gender.

**`groupId` on `ClientInput` is coalesced, not assigned.** Omitting it leaves a
client in whatever group they are in, so a payload that says nothing about the
group cannot empty one by saving a name change. Moving a client between groups, or
out of one, goes through `set_client_group` — including from the client form,
which sends no `groupId` and calls `set_client_group` after the save.

`Client` responses add `activePolicies`, `totalPolicies`, `nextExpiry`,
`relatives` (edges in either direction), `isDependent` and `groupName`.

**`delete_client`** takes `scope`, which is `linksOnly` (the default) or
`immediateFamily`, and answers with every id it removed. `linksOnly` cascades to
that client's policies, documents and relationship edges, and leaves the people on
the other end of those edges alone — they are clients. `immediateFamily` deletes
the client and the people one step out from them, and no further.

**`set_family_archived`** archives or restores the client together with the people
one step out, answering with how many rows moved. `set_client_archived` is the
single-client version, and both are the reversible alternative the UI offers
first.

Errors: `validation` (missing name, bad email, bad date of birth), `conflict`
(client code in use), `not_found`.

## Family

| Command | Arguments | Returns |
| --- | --- | --- |
| `list_relatives` | `clientId: number` | `Relative[]` |
| `client_family` | `clientId: number` | `Family` |
| `link_clients` | `input: RelationInput` | `void` |
| `unlink_clients` | `clientId: number`, `relatedClientId: number` | `void` |

There is no member entity and no family id. A family is the set of clients
reachable through `client_relations` in either direction, which is what lets one
person belong to two families at once — see
[DATA-MODEL](DATA-MODEL.md) for the invariants.

`RelationInput` is `clientId`, `relatedClientId` and `relationship`, read as "the
related client is the `relationship` of the client". `relationship` must be one of
`spouse | son | daughter | father | mother | brother | sister | other`; anything
else is `validation`, because the interface picks from a fixed list. The importer
is the lenient path — `util::normalise_relationship` maps "wife" and "husband"
onto `spouse` and files an unrecognised word under `other`.

**The pair is unique, not the direction.** Linking two clients who are already
linked rewrites the single edge, including the direction it is stored in, so
recording "father" from the son's page corrects rather than contradicts "son"
recorded from the father's. `Relative` therefore carries `outgoing`, saying which
way round the stored edge is, and the interface reads the stored word aloud — "Son"
one way, "Son of" the other — rather than guessing its opposite.

An edge that would make somebody their own ancestor is refused with `validation`.
Only parent and child edges are checked: a spouse or sibling edge that closes a
loop is a family with two ways through it, not a broken one.

`Relative` rows come back spouse first, then children, then parents, then everyone
else, by name within each. `Family` is `{ members, edges }`, where each
`FamilyMember` carries `steps` — the shortest walk from the client asked about, so
the interface can lay out the tree without repeating the traversal. The walk stops
at 12 steps.

**`unlink_clients`** removes the edge whichever way round it is stored, and
`not_found` when there is none. The people stay; one of them holding cover of
their own is the ordinary case.

## Groups

| Command | Arguments | Returns |
| --- | --- | --- |
| `list_groups` | `filter: GroupFilter` | `Page<Group>` |
| `get_group` | `id: number` | `Group` |
| `create_group` | `input: GroupInput` | `number` |
| `update_group` | `id: number`, `input: GroupInput` | `void` |
| `set_group_archived` | `id: number`, `archived: boolean` | `number` |
| `delete_group` | `id: number` | `number` |
| `set_client_group` | `clientId: number`, `groupId?: number` | `void` |
| `next_group_code` | — | `string` |

A group is a named set of clients the agency works as one book, and the contact
who referred them. Unlike a family it is a row, because it has the boundary a
family lacks — see [DATA-MODEL](DATA-MODEL.md) for why the two are stored
differently. The roster is not a command here: it is `list_clients` with
`groupId` set.

`GroupInput` is `name` (required), `headName`, `headDesignation`, `headPhone`,
`headEmail`, `groupCode` and `notes`, all optional and all nullable. `groupCode`
is allocated as the next `GR-000NN` when omitted, and coalesced on update the way
`clientCode` is. **Only the name is required**: a group is a filing arrangement
first and a referral second, so all four head fields may be left empty, and a
`headName` of whitespace is stored as `NULL` rather than as empty text.

The head is held to the shape a client's contact details are. `headName` is
title-cased by `util::tidy_name`, `headPhone` normalised by
`util::normalise_phone` — `+91 98765-43210` stores as `+919876543210`, and a
number that normalises to nothing stores `NULL` — and `headEmail` checked by
`util::looks_like_email`, returning `validation` with **The group head's email is
not an address**. A blank email is `NULL` rather than an error.
`headDesignation` is stored as typed, the way `contactDesignation` is.

`GroupFilter`: `search`, `includeArchived`, `sort`, `descending`, `page`,
`pageSize`. `search` is a `LIKE` scan over the group name, the group code and the
head's name, all read off `client_groups` — an operator looking for "the firms
Mehta brought us" knows the introducer, not the folder. Sort keys: `name`
(default), `code`, `members`, `policies`, `premium`, `nextExpiry`, `created`,
`updated`.

`Group` responses carry `headName`, `headDesignation`, `headPhone` and
`headEmail`, and the group's book summed across its members: `members`,
`activePolicies`, `totalPolicies`, `premiumUnderManagement` and `nextExpiry`.
**The head contributes none of it**: they are a name and a phone number rather
than somebody who holds policies. Nothing about a group references `clients`, so
there is no id to follow to a client page and no way to ask which groups a client
referred.

**`delete_group`** removes the group and answers with how many clients it let go.
They stay in the book with no group. **`set_group_archived`** archives or restores
the group and every client in it, answering with how many clients moved. Deleting
a client reaches no group.

**`set_client_group`** is the only place membership is said out loud. Passing no
`groupId` takes the client out of whatever group they are in.

Errors: `validation` (missing name, malformed head email), `conflict` (group code
or name in use), `not_found`.

## Documents

| Command | Arguments | Returns |
| --- | --- | --- |
| `list_documents` | `clientId: number` | `Document[]` |
| `attach_document` | `input: DocumentInput` | `number` |
| `document_content` | `id: number` | `ArrayBuffer` |
| `save_document_copy` | `id: number`, `path: string` | `void` |
| `delete_document` | `id: number` | `void` |

`DocumentInput` carries `clientId`, the `path` of the file to copy in, an
optional `policyId` and an optional `title` that defaults to the file name
without its extension. The backend reads the file itself, so the bytes never
cross the bridge on the way in.

**`attach_document` copies; it never moves.** The agent's own file is left where
it is, and removing the attachment does not touch it.

Accepted types are PDF, PNG, JPG and WEBP, decided by extension, and a single
file may not exceed 20 MB. Anything else returns `validation` naming the limit.
The same bytes attached twice to one client return `conflict`, matched on the
SHA-256 the row stores; the same file across two clients is a shared form and is
allowed.

**`document_content` answers with raw bytes rather than JSON**, so a scan reaches
the viewer without a base64 round trip. `api.documentContent` types it as an
`ArrayBuffer`, which the interface turns into a `Blob` URL and revokes when the
viewer closes. Bytes are written to disk only by `save_document_copy`, at a path
the agent picks.

`Document` responses carry metadata only — `title`, `fileName`, `mimeType`,
`sizeBytes`, `uploadedAt` and the `policyNumber` of the policy they hang off,
when they hang off one. Lists come back newest first.

Errors: `validation` (unreadable path, unsupported type, empty file, over the
size limit), `conflict` (already attached to this client), `not_found`.

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
| `policy_insured_ids` | `id: number` | `number[]` |
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
`premiumFrequency` defaults to `annual`. Vehicle numbers are upper-cased. The
health fields below are optional whatever the category.
`insuredClientIds` replaces the set of lives covered; omitting it on update leaves
the set alone. Only the policyholder and the clients related to them can be named
— any other id is dropped by the `INSERT ... WHERE` that writes the set, so a
stale or hostile id cannot put a stranger on the cover.

`Policy` responses are read from the `policy_overview` view, so they carry the
client and insurer names alongside `daysToExpiry`, `isRenewed`, `chainId`,
`policyYear` and `previousPolicyId`.

### The health fields

`variant`, `riders`, `planType`, `term`, `policyType`, `broker` and
`inbuiltRider` describe health cover the way the insurer's proposal form asks for
it. All seven are optional on `PolicyInput` and nullable on `Policy`; the
add-policy screen requires them of a health policy, and the core does not, so a
spreadsheet that predates the questions still imports.

What the core does check is the vocabulary, returning `validation` for a word it
does not know:

| Field | Values |
| --- | --- |
| `riders` | `safeguard`, `safeguard_plus`, `pa_main_member`, `future_ready`, `fast_forwarded` |
| `planType` | `individual`, `family_floater` |
| `policyType` | `fresh`, `portability`, `renewal` |
| `term` | 1 to 5 |

`riders` is a list on the way in and a list on the way out, held in one
comma-separated column in between. The order it is sent in does not matter: it is
stored and returned in the order above, so the same set always reads the same.

`renew_policy` carries all seven into the new year, with two consequences worth
knowing. The new year's `policyType` becomes `renewal` whenever the year behind it
had one at all, so a policy ported in last year is a renewal this year. And a
renewal that does not name its own dates runs for `term` years rather than one,
because that is the cover that was bought.

**`policy_chain`** returns every year of the chain the policy belongs to, oldest
first.

**`renew_policy`** appends the next year rather than editing the current one. It
takes `policyId` plus optional `policyNumber`, `startDate`, `expiryDate`,
`sumInsured`, `premiumAmount`, `gstAmount`, `commissionRate`,
`commissionExpected` and `notes`. Anything omitted is carried forward from the
policy being renewed; the term defaults to the day after expiry through a year
minus a day; the lives covered are copied; the expiring year becomes `renewed`,
unless it is `cancelled`, which stands — see the invariant in
[DATA-MODEL](DATA-MODEL.md). A year that already has a successor returns
`conflict`: renew the latest year in the chain instead.

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
with up to 300 `issues` carrying a 1-based spreadsheet `row` and a `message`.
Where the failure is about one cell — a blank name, a blank policy number or
insurer, an unreadable expiry, a policy already present with updates switched
off — the issue also carries the `column` it was read from and the `value` it
held, both null otherwise, and `value` null for a cell that was empty. A failed
row is rolled back whole; nothing half-created survives it.

**Corporate fields.** `import_fields` also offers `clientKind`, `groupName`,
`contactPerson`, `contactDesignation`, `registrationNo` and `gstin`, all
optional, all in the `Client` group. `clientKind` is read loosely — a cell
containing `compan`, `corp`, `firm`, `llp`, `ltd`, `pvt`, `private limited`,
`partnership`, `enterprise` or `business` is a company, anything else a person —
and the client's name is never read for it. On an existing client the type fills
upwards only: `company` overwrites `individual`, and nothing overwrites
`company`. `groupName` finds a group by name, case-insensitively, or opens one
with no head on file, then files the client through the same path
`set_client_group` uses; a blank leaves membership alone.

These six are matched last, so headings an older book already spends keep their
meanings: `Type` stays `category`, `GST` stays `gstAmount`, `Registration No`
stays `vehicleNumber`. The spelled-out `Client type`, `GSTIN` and
`Registration number` reach the corporate fields.

**`write_import_template`** writes an `.xlsx` with every recognised column and
one example row, and returns the path.

**Export** commands take the same filters as the matching list command, ignore
pagination, and write `.xlsx` or `.csv` chosen by the file extension. Anything
else returns `validation`. The return value is the number of rows written.
`export_clients` writes `Type` and `Group` after the name, and `GSTIN`,
`Registration number`, `Contact person` and `Designation` after the PAN, so the
sheet it produces is one the importer reads back whole. `Type` is written as
`Individual` or `Company`, the words the screens use.

## Message templates

| Command | Arguments | Returns |
| --- | --- | --- |
| `list_templates` | — | `EmailTemplate[]` |
| `create_template` | `input: EmailTemplateInput` | `number` |
| `update_template` | `id: number`, `input: EmailTemplateInput` | `void` |
| `delete_template` | `id: number` | `void` |
| `template_placeholders` | — | `Placeholder[]` |
| `preview_template` | `subject: string`, `bodyHtml: string` | `TemplatePreview` |

`EmailTemplateInput` requires `name`, `trigger`, `subject` and `bodyHtml`.
`trigger` is one of `expiry_reminder`, `post_expiry`, `welcome`,
`renewal_confirmation`, `annual_summary`, `provider_digest`, `custom`. Names are
unique. `EmailTemplate` responses add `usedByRules`.

**`delete_template` refuses while a rule points at it** and returns `conflict`
naming the count, so a rule cannot silently lose the message it sends.

**`template_placeholders`** returns the whole catalogue — `client_name`,
`policy_number`, `expiry_date`, `days_to_expiry`, `premium_amount`,
`provider_name` and the rest — each with the description shown beside it in the
editor. It needs no database.

**`preview_template`** renders unsaved editor content against a real policy,
preferring one that expires soon, and falls back to worked-up example values
when the book is empty. It returns the rendered `subject`, `html`, the derived
plain-text `text` part, `samplePolicy` naming what the values came from, and
`unknownPlaceholders` — names the catalogue does not hold, which are almost
always typos.

Placeholders are written `{{name}}` and are HTML-escaped. `{{{name}}}` inserts
raw HTML and exists for values the app builds itself, such as `digest_table`. A
name that resolves to nothing renders as empty rather than being left in the
message.

Errors: `validation` (missing name, subject or body, unknown trigger),
`conflict` (duplicate name, template in use), `not_found`.

## Reminder rules

| Command | Arguments | Returns |
| --- | --- | --- |
| `list_rules` | — | `ReminderRule[]` |
| `create_rule` | `input: ReminderRuleInput` | `number` |
| `update_rule` | `id: number`, `input: ReminderRuleInput` | `void` |
| `delete_rule` | `id: number` | `void` |

A rule is one rung of the ladder: send `template` to `audience` when a policy is
`offsetDays` from expiry. `ReminderRuleInput` takes `name`, `offsetDays`,
optional `category`, `audience`, `channel`, optional `templateId`, `isActive`
and `sortOrder`.

- **`offsetDays` counts back from expiry.** 30 means 30 days before; a negative
  value is that many days after, and those rules match only `expired` or
  `lapsed` policies with no successor. The range is −365 to 365.
- **`audience`** is `client` or `provider`. A `client` rule must name a
  template, because it has nothing to say without one.
- **`channel`** is `email`, `desktop` or `both`.
- **`category`** narrows the rule to one policy category; omitted means all.

Rules are listed furthest ahead of expiry first, then by `sortOrder` and name.
Names are unique. Deleting a rule leaves its history: `notification_log.rule_id`
becomes `NULL` rather than the sent record disappearing.

Errors: `validation` (missing name, offset out of range, unknown audience,
channel or category, client rule with no template), `conflict` (duplicate name),
`not_found` (unknown template or rule).

## Reminders

| Command | Arguments | Returns |
| --- | --- | --- |
| `reminder_overview` | — | `ReminderOverview` |
| `plan_reminders` | — | `PlannedReminder[]` |
| `run_reminders` | `dryRun?: boolean` | `ReminderRun` |
| `list_notifications` | `filter: NotificationFilter` | `Page<Notification>` |
| `retry_notification` | `id: number` | `void` |
| `cancel_notification` | `id: number` | `void` |
| `set_smtp_password` | `password?: string` | `void` |
| `send_test_email` | `to: string` | `void` |

**`reminder_overview`** is everything the reminders screen needs to describe the
state in a sentence: `enabled`, `dryRun`, `smtpConfigured`, `smtpPasswordSet`,
`fromEmail`, `sendTime`, `dailyCap`, `digestEnabled`, `desktopAlerts`,
`activeRules`, `dueToday`, `queued`, `failed`, `sentToday`, `lastSweep`,
`clientsOptedOut` and `expiringWithoutEmail`.

**`plan_reminders`** matches today's date against the active rules and returns
what would go out, writing nothing. Each `PlannedReminder` carries the rule, the
policy, the client, the resolved `subject`, and `blockedReason` when the
reminder will not be sent — an opted-out client, a missing address, an address
that does not parse.

**`run_reminders`** plans, queues and sends in one pass, and returns counts of
`queued`, `sent`, `failed`, `skipped`, `heldByCap`, `desktopAlerts`,
`digestSent` and up to 20 `issues`. `dryRun` overrides the `dry_run` setting for
this run only.

- **A reminder fires once per policy year.** `UNIQUE (rule_id, policy_id,
  policy_period)` on the outbox is what guarantees it, however often the sweep
  runs.
- **A blocked reminder is recorded as `skipped`, once,** so the operator can see
  why nothing went out and the same client is not raised again tomorrow.
- **A failed send stays `queued`** for three attempts before it is parked as
  `failed`, which rides out a mail server having a bad morning without the
  operator intervening.
- **The daily cap is a send limit, not a queue limit.** What is over the cap
  stays queued for tomorrow and is counted in `heldByCap`.
- **A dry run writes nothing and sends nothing** — no outbox rows, no
  `last_sweep_at`. It reports what a real run would queue.
- **Renewing cancels the pending reminders** for the year that was renewed, so a
  reminder queued yesterday does not chase a client who has already renewed.

`NotificationFilter`: `statuses[]`, `clientId`, `policyId`, `search` (address,
subject or client name), `sort`, `descending`, `page`, `pageSize`. Sort keys:
`scheduledFor` (default, newest first), `createdAt`, `sentAt`, `status`,
`clientName`. Statuses: `queued`, `sent`, `failed`, `skipped`, `cancelled`.

**`retry_notification`** puts a failed, skipped or cancelled row back in the
queue with its attempt count reset. **`cancel_notification`** stops a queued one.
Either returns `conflict` when the row is not in a state that allows it.

**`set_smtp_password`** writes the mail password to the OS keychain, or clears
it when given nothing. **It is never stored in the database**, so it does not
travel inside an export or a backup copied to a cloud folder. It requires an
unlocked session, and there is no command that reads it back.

**`send_test_email`** opens a connection, verifies it and sends one message, so
a wrong password is found here rather than through a queue full of failures.
Errors: `validation` (not an email address), `mail` (no server configured, or
the server refused).

The backend emits `reminders:swept` after a scheduled sweep; the interface
listens for it and refetches.

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
| `reminders_enabled` | `false` | Whether the scheduler runs the daily sweep |
| `reminder_send_time` | `09:00` | Local time the sweep runs |
| `daily_send_cap` | `400` | Messages sent per day; the rest stay queued |
| `digest_enabled` | `true` | Send the agency one summary of the day's expiries |
| `dry_run` | `true` | Sweeps work everything out and send nothing |
| `last_sweep_at` | unset | RFC 3339 stamp of the last live sweep; written by the sweep, not by hand |
| `smtp_host` / `smtp_port` / `smtp_username` / `smtp_from_name` / `smtp_from_email` / `smtp_encryption` | empty, `587`, `starttls` | The mail server. `smtp_encryption` is `starttls`, `tls` or `none` |

The mail password is not a setting — it lives in the OS keychain and is written
through `set_smtp_password`.

## Enumerations

| Enum | Values |
| --- | --- |
| Category | `health`, `life`, `motor`, `travel`, `home`, `personal_accident`, `critical_illness`, `other` |
| Policy status | `active`, `expired`, `renewed`, `lapsed`, `cancelled` |
| Relationship | `spouse`, `son`, `daughter`, `father`, `mother`, `brother`, `sister`, `other` |
| Delete scope | `linksOnly`, `immediateFamily` |
| Client kind | `individual`, `company` |
| Premium frequency | `annual`, `half_yearly`, `quarterly`, `monthly`, `single` |
| Gender | `male`, `female`, `other` |
| Template trigger | `expiry_reminder`, `post_expiry`, `welcome`, `renewal_confirmation`, `annual_summary`, `provider_digest`, `custom` |
| Reminder audience | `client`, `provider` |
| Reminder channel | `email`, `desktop`, `both` |
| Notification status | `queued`, `sent`, `failed`, `skipped`, `cancelled` |

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
