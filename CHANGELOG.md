# Release notes

What changed in each version of StayInsured, written for the person using it.

Upgrading replaces the app and never the data: your book, your backups and your
settings survive every version below.

## Unreleased

- The published guide fills the window and reads at a larger size, so the
  screenshots of each screen are legible rather than shrunk to half width.

## 0.1.0 — 15 August 2026

The first release. Everything below is new.

### Your book

- **Clients** with contact details, address, occupation, PAN and notes. Search
  by name, phone, email, client code or PAN; filter by city, by the kind of
  cover held, or by who has no email address.
- **Insured members** recorded once against a client and attached to the health
  and travel policies that cover them.
- **Policies** with insurer, plan, category, dates, sum insured, premium, GST,
  commission, nominee and vehicle number. One client holds as many as they need.
- **Archive** takes a client out of the working list while keeping every record;
  deleting is separate, and asks first.

### Renewals

- A **renewals desk** grouped by how soon cover stops: overdue, then the next 7,
  30, 60 and 90 days.
- **Recording a renewal** writes the new policy year and keeps the expiring one,
  linked as history, so what a client paid each year stays on record.
- **Copy emails** puts the addresses for a tab on the clipboard, skipping clients
  with no address and clients who asked not to be contacted.
- **Statuses follow the calendar.** Expired means the date has passed; lapsed
  means more than thirty days have passed with nothing replacing the cover.

### Getting your book in

- **Import** from `.xlsx`, `.xls`, `.xlsm`, `.ods`, `.csv` and `.tsv`, matching
  your column headings automatically against 32 fields.
- **Check without saving** performs the entire import and reports what it would
  do, naming every row it cannot read, before anything is written.
- Re-importing a corrected file updates the records you already hold instead of
  duplicating them.
- **Export** on the clients, policies and renewals screens saves exactly what
  the current filters show, as Excel or CSV.

### Your data

- The whole book is one **SQLCipher-encrypted** database on your machine.
  Nothing is uploaded, and no feature needs the internet.
- **Trust this device** holds the key in the macOS Keychain or Windows
  Credential Manager, so opening the app is one click.
- **Backups** are encrypted copies, mirrored to a folder you choose — point it
  at a synced folder and a lost laptop costs you nothing.

### Documentation

- An illustrated guide covering every operation, one page each, published at
  https://laksagent-png.github.io/StayInsured/.

### Still to come

Automatic reminder emails, stored policy documents, claims tracking, the
printable report pack, and separate logins for staff. Each is planned, and none
of them is switched on in this version.
