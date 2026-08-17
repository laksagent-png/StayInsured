# Data model

The schema lives in `src-tauri/src/db/schema/`, applied by
`src-tauri/src/db/migrations.rs`. Everything below is one encrypted SQLite
database, `stayinsured.db`, opened through SQLCipher.

Current schema version: **4** — `001_init.sql` (structure), `002_seed.sql`
(defaults), `003_documents.sql` (stored files) and `004_search_index.sql` (the
client search triggers, and a rebuild of the index behind them).
`session_state.schemaVersion` reports it at runtime.

## Migration policy

`MIGRATIONS` is an ordered list of `(version, sql)` compiled in with
`include_str!` and tracked in `PRAGMA user_version`. All pending steps run inside
one transaction when the database is opened.

**A shipped migration is never edited.** Users have already applied it, and
editing it changes nothing on their machine while silently diverging from the
schema fresh installs get. Any change is a new numbered file added to the list.

## Entities in use

```mermaid
erDiagram
    clients ||--o{ insured_members : has
    clients ||--o{ policies : holds
    clients ||--o{ documents : keeps
    policies ||--o{ documents : "evidenced by"
    documents ||--|| document_contents : stores
    insurers ||--o{ products : offers
    insurers ||--o{ policies : underwrites
    products ||--o{ policies : "instantiated as"
    policies ||--o{ policy_members : covers
    insured_members ||--o{ policy_members : "covered by"
    policies ||--o| policies : "renews into"
    email_templates ||--o{ reminder_rules : "sent by"
    reminder_rules ||--o{ notification_log : produces
    policies ||--o{ notification_log : "chased by"
```

### `clients`

The client book. `client_code` is unique and allocated as `CL-00001` upward from
the highest numeric suffix matching `CL-[0-9]*`.

Contact and identity: `full_name` (required), `email`, `phone`, `alt_phone`,
`date_of_birth`, `gender`, `address_line1`, `address_line2`, `city`, `state`,
`pincode`, `occupation`, `pan`, `gstin`. Behaviour: `preferred_language`
(default `en`), `reminders_opted_out`, `notes`, `is_archived`.

Names are title-cased, phones reduced to digits with an optional leading `+`, PAN
and GSTIN upper-cased, and blank text stored as `NULL`. Indexed on name, email,
phone, city and archived state.

### `insured_members`

Family members and dependents who can be covered by that client's policies.
Cascades on client delete. `relationship` is constrained to
`self | spouse | son | daughter | father | mother | other`.

### `insurers`

Insurance companies. `name` is unique, `short_code` is upper-cased and used for
import matching, plus `website`, `claim_helpline`, `support_email`, `notes` and
`is_active`. Twenty-five Indian insurers are seeded so the first policy can be
entered without setup.

### `products`

Plans an insurer offers. Unique on `(insurer_id, name)`, carries a `category`
from the category domain, and cascades on insurer delete.

### `policies`

One row per **policy year**, not per policy.

| Column group | Columns |
| --- | --- |
| Chain | `chain_id`, `policy_year`, `previous_policy_id` |
| Identity | `policy_number`, `client_id`, `insurer_id`, `product_id`, `category` |
| Lifecycle | `status`, `start_date`, `expiry_date` |
| Money | `sum_insured`, `premium_amount`, `gst_amount`, `premium_frequency`, `payment_mode`, `next_due_date`, `commission_rate`, `commission_expected` |
| Detail | `nominee_name`, `nominee_relation`, `vehicle_number`, `notes` |

Constraints: `UNIQUE (insurer_id, policy_number)`; `client_id` cascades on
delete; `insurer_id` is restricted; `product_id` and `previous_policy_id` are set
to `NULL` when their target goes. Indexed on client, expiry, status, chain,
category, insurer and previous policy.

### `policy_members`

Which insured members a policy year covers — `(policy_id, member_id)`, cascading
on both sides. The insert path only accepts members belonging to the policy's own
client.

### `documents` and `document_contents`

Scans and paperwork, held **inside** the encrypted database rather than beside
it. `documents` carries `client_id` (cascading), an optional `policy_id` set to
`NULL` when the policy goes, `title`, `file_name`, `mime_type`, `size_bytes`,
`sha256` and `uploaded_at`. `document_contents` holds the bytes, one row per
document, cascading on delete.

The split is not decorative. SQLite packs the beginning of a blob into the row's
own page, so a listing that shared a table with the file bytes would page through
megabytes of scan to read a column of titles.

`UNIQUE (client_id, sha256)` makes attaching the same file to one client twice a
`conflict`. Across clients it is a shared form, and stays allowed.

## Domains

| Domain | Values | Enforced by |
| --- | --- | --- |
| Category | `health`, `life`, `motor`, `travel`, `home`, `personal_accident`, `critical_illness`, `other` | `CHECK` on `products` and `policies` |
| Policy status | `active`, `expired`, `renewed`, `lapsed`, `cancelled` | `CHECK` on `policies` |
| Premium frequency | `annual`, `half_yearly`, `quarterly`, `monthly`, `single` | `CHECK` on `policies` |
| Relationship | `self`, `spouse`, `son`, `daughter`, `father`, `mother`, `other` | `CHECK` on `insured_members` |
| Gender | `male`, `female`, `other` | `CHECK` on `clients` and `insured_members` |
| User role | `owner`, `staff`, `readonly` | `CHECK` on `users` |

Dates are ISO `YYYY-MM-DD` text. Timestamps are `datetime('now')`, so UTC.
Booleans are `INTEGER` 0/1. Money is `REAL`.

## Invariants

These hold across the whole database and the code depends on them.

1. **A policy year is never mutated by a renewal.** Renewing inserts a new row
   with the same `chain_id`, `policy_year + 1` and `previous_policy_id` pointing
   at the year it replaces.
2. **A chain has exactly one head.** The current year is the row in the chain
   with no successor — which is what `is_renewed = 0` means. `policies::renew`
   refuses a year that already has one, so a chain cannot fork into two open
   years; before that guard existed, only the interface's own buttons kept it
   from happening.
3. **Status is derived, except `cancelled`.** `sync_statuses` recalculates
   `active`, `expired`, `renewed` and `lapsed` from today's date and chain
   position on every unlock, after every real import, and on demand.
   `cancelled` is only ever set by hand and is never overwritten — including by
   a renewal, which marks the year it replaces `renewed` unless that year was
   cancelled. A cancelled year that has been renewed is still `is_renewed`, so
   it stays off the renewals desk and out of the open-year count; the status
   column is where the book remembers that the cover was ended early.
4. **A policy number is unique per insurer.** Two insurers may use the same
   number; one insurer may not. This is why a renewal needs a fresh number.
5. **A member only attaches to their own client's policies.** Enforced by the
   insert query, not just by the UI.
6. **Deleting a client removes their policies and members.** Archiving is the
   reversible alternative and what the interface offers first.
7. **An insurer carrying policies cannot be deleted.** Deactivation is the way to
   retire one.
8. **Blank means `NULL`.** Optional text is trimmed and empty values stored as
   `NULL`, so unique indexes and the "missing email" filter behave predictably.
9. **One rule sends to one policy year once.** `UNIQUE (rule_id, policy_id,
   policy_period)` on `notification_log`, written before the send is attempted,
   is what makes that true across restarts and repeated sweeps.
10. **Everything the agent stores lives in this one file.** A backup is a single
    `VACUUM INTO` of the database, so a scan kept beside it would be both the one
    unencrypted part of a client's record and the one part a backup leaves
    behind. This is why document bytes are a blob and not a path.

## Derived objects

### `policy_overview`

The view every grid, filter, dashboard tile and export reads. It joins policy,
client, insurer and product, and adds two computed columns:

- `days_to_expiry` — `julianday(expiry_date) - julianday(date('now','localtime'))`,
  so it is live and follows the user's local midnight.
- `is_renewed` — whether any row's `previous_policy_id` points at this one.

Reading everything through one view is what stops the dashboard and the renewals
list from disagreeing about "expiring in 30 days". `POLICY_COLUMNS` in
`models.rs` pins the column order `Policy::from_row` expects, so the two must be
edited together.

### `clients_fts`

An FTS5 external-content index over `full_name`, `email`, `phone`, `client_code`
and `pan`, tokenised with `unicode61 remove_diacritics 2`. Three triggers
(`clients_fts_ai`, `_ad`, `_au`) keep it in step with `clients`. Client search
builds a prefix query from the search terms and falls back to a `LIKE` scan when
no searchable token survives.

`_au` carries a `WHEN` clause naming those five columns, added by
`004_search_index.sql`; see the touch triggers below for why it has to. Note that
FTS5's `integrity-check` reads the index against itself and not against
`clients`, so it will pass an index that has drifted out of agreement with the
book. The tests that matter therefore assert what a search returns, not only that
the check is clean.

### Touch triggers

`clients_touch` and `policies_touch` maintain `updated_at` on update.

**A trigger on a table that has an FTS mirror must not update that table.**
`clients_touch` does exactly that, and SQLite fires the two `AFTER UPDATE ON
clients` triggers in an order it does not promise — newest first, in practice, so
the touch goes first. Its nested `UPDATE clients SET updated_at` re-enters
`clients_fts_au`, whose `old` and `new` then both hold the row as it already
stands, and the index is told to delete a row image it never held. FTS5 keeps a
per-column word count for the whole table and subtracts the deleted image from
it; when the saved row has more words in some column than the entire book has
recorded there, the count would go negative and the save is refused with
`SQLITE_CORRUPT` — "database disk image is malformed". That made editing a client
fail outright on a small book, or on any book where the column being filled in
was empty throughout (`pan`, most often), while passing unnoticed on a large one.
The `WHEN` clause on `_au` is what closes it: a touch changes no indexed column,
so it can no longer re-enter the trigger. `policies_touch` has the same shape and
is harmless only because nothing indexes `policies`; a `policies_fts` would need
the same `WHEN` clause from the start.

## Supporting tables

### `users`

One `owner` row today, holding `display_name` and an Argon2 `password_hash`
separate from the database key, plus `role`, `is_active`, `created_at` and
`last_login_at`. The role domain is already in place for staff accounts.

### `settings`

Key/value store with `updated_at`, upserted by `save_settings`. Keys and defaults
are listed in [API.md](API.md#settings-keys).

### `import_batches` and `import_errors`

Every committed import records its file name, source type, counts and the mapping
JSON used, with each reported issue in `import_errors`. Dry runs write nothing.

## Reminders

### `email_templates`

`name` (unique), `trigger`, `subject`, `body_html`, `is_active` and timestamps.
`trigger` is checked against `expiry_reminder`, `post_expiry`, `welcome`,
`renewal_confirmation`, `annual_summary`, `provider_digest`, `custom`. Bodies
hold `{{placeholders}}`; the catalogue of names lives in `templating::CATALOGUE`
rather than in the database, so the editor and the renderer cannot disagree.
Five templates are seeded.

A template cannot be deleted while a rule points at it. That is enforced in the
repository rather than by a constraint, because the message it returns names how
many rules are affected.

### `reminder_rules`

`name` (unique), `offset_days`, optional `category`, `audience`, `channel`,
`template_id`, `is_active`, `sort_order`.

**`offset_days` is counted from expiry: positive is before, negative after.**
The seeded ladder is 60, 30, 15, 7 and 1 day before, all active, plus a
seven-day-after rule that ships inactive.

`template_id` is `ON DELETE SET NULL`, and `audience` and `channel` are checked
against `client | provider` and `email | desktop | both`.

### `notification_log`

The outbox. A row is written before anything is sent, carrying `rule_id`,
`policy_id`, `client_id`, `policy_period`, `audience`, `channel`, `to_address`,
`subject`, `body_snapshot`, `status`, `attempts`, `last_error`, `scheduled_for`
and `sent_at`. `status` is checked against `queued | sent | failed | skipped |
cancelled`. Indexed on status, `scheduled_for` and policy.

**`UNIQUE (rule_id, policy_id, policy_period)` is the invariant the whole
reminder feature rests on.** `policy_period` holds the expiry date of the policy
year being chased, so the key reads "this rule, this policy, this year" and a
reminder fires exactly once per policy year however often the scheduler sweeps
or the app restarts. Queueing uses `INSERT OR IGNORE`, so the second attempt is
a no-op rather than an error.

`rule_id` is `ON DELETE SET NULL`: deleting a rule must not erase the record of
what it sent. `policy_id` and `client_id` cascade, because a deleted client's
send history has nothing left to describe.

`body_snapshot` keeps the message as it was rendered. Editing a template later
does not rewrite what a client was actually sent.

## Reserved for unbuilt features

These tables are created and no screen writes to them yet. They exist because
their shape constrains the design of what is built.

| Table | Purpose | State |
| --- | --- | --- |
| `premium_payments` | Installment schedule and receipts | Empty |
| `commissions` | Expected versus received payout | Empty; `policies` carries the summary fields the UI uses |
| `claims` | Claim intimation through settlement | Empty; documents will hang off a claim the way they hang off a policy |
| `audit_log` | Before and after JSON per change | Empty |
| `saved_views` | Named filter sets per entity | Empty |
