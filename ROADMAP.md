# Roadmap

What works today, what is only scaffolding, and what comes next. Kept honest:
a table in the schema is not a feature until there is code behind it.

## Built and working

**Security and access**
Encrypted SQLCipher database unlocked by an Argon2id-derived key. Optional
keychain trust for one-click daily unlock, change password, lock, forget this
device, on-demand encrypted backup, reveal data folder.

**Client book**
Clients with contact details, addresses and generated codes. Full-text search.
Filters by city, category, missing email and archived state. Archive rather than
delete. A detail page per client with their insured family members.

**Policies**
Any number per client across categories. Each policy year is its own record
linked into a renewal chain, so renewing preserves history rather than
overwriting it. Duplicate policy numbers for the same insurer are rejected,
statuses follow the calendar, members attach per policy.

**Renewals desk**
Policies bucketed as overdue, 7, 30, 60 and 90 days. Recalculate statuses, copy
all client emails, export any bucket.

**Dashboard**
Book size, premium under management, expected commission, expiry buckets and
category split, each linking through to the matching filtered list.

**Import and export**
Excel, CSV and TSV import with guessed column mapping, preview, and a dry run
that validates without touching the database. Every row is a savepoint, so a bad
row leaves nothing behind and re-importing a file creates no duplicates. Runs are
recorded to `import_batches` and `import_errors`. Clients and policies export to
`.xlsx` or `.csv`.

**Catalogue and shell**
Insurers and products. Sidebar navigation, tray icon, close-to-tray so
background work survives, autostart toggle, settings.

Twelve data-layer tests cover migrations, wrong-password rejection, renewal
chains, status rules, import idempotency, export and backup.

## Scaffolding only

These have schema and in some cases seed data, but no code behind them.

- **Reminders.** Six reminder rules and one email template are seeded, and the
  SMTP settings keys exist, but nothing sends mail, no scheduler runs, there is
  no template editor, and `notification_log` is never written. Desktop
  notification permission is declared but no notification is fired.
- **Money.** Policies carry a commission rate and expected amount, but
  `premium_payments` and the `commissions` ledger are unused — no payment
  schedule, no receipts, no expected-versus-received view.
- **Documents.** The folder is created; the table is never written.
- **Claims**, **audit log**, **saved views.** Tables only.

Also absent: any report beyond the dashboard, an import history screen despite
the data being recorded, and multi-user — the `users` table holds a single owner
with no roles or second account.

## Next

**1. Reminders** — the feature that motivated the tool.
SMTP settings with a send-test. A template editor with insertable placeholders.
The multi-stage schedule (60/30/15/7/1 days before expiry). An outbox so a failed
send retries instead of vanishing. A dry-run mode showing what would go out.
Per-client opt-out honoured, a daily send cap, and provider-side digests by email
or desktop notification.

**2. Reports** — renewal pipeline, renewal versus lapse rate, book breakdown,
premium and commission revenue, annual per-client summary. All exportable.

**3. Money tracking** — premium payment schedules and receipts, and a commission
ledger of expected versus received.

**4. Documents** — policy PDFs and ID proofs attached to clients and policies,
stored in the encrypted data folder.

**5. Smaller gaps** — claims logging, saved filter presets, import history,
scheduled automatic backups, audit log.

Multi-user is deliberately deferred. The schema anticipates it; building it
before there is a second user would be guesswork.
