# Release notes

Upgrading replaces the app and never the data: your book, your backups and your
settings survive every version below.

## Upcoming

### Fixed

- **Lock app takes you to the unlock screen.** It closed the book but left the
  old screen up, so every list and every save then failed and the only way back
  in was to quit the app and start it again. Locking now shows the unlock screen
  straight away, from the sidebar button and from **Lock now** in the tray menu
  alike, and on a trusted device it asks for your password instead of letting
  itself back in.

- **A policy comes back to the renewals desk when you delete its renewal.**
  Removing a renewal you had entered by mistake used to leave the year before it
  marked as renewed, so a policy that was still running disappeared from the
  desk and from the active count. It is now picked up again on the next
  recalculation, as active, expiring or lapsed according to its dates.

## 0.3.0 — 15 August 2026

### Documents

- **Keep the paperwork with the client.** Every client page has a Documents
  panel: attach the policy schedule, the signed proposal, the RC book or an ID
  proof, say which policy it belongs to, and open it from there. PDFs and
  photographs both show in the app.
- **The scans go inside your encrypted book**, not in a folder beside it, so your
  backup carries them, your password protects them, and moving to a new computer
  brings them along.
- Attaching copies your file rather than moving it, so tidying your Downloads
  folder afterwards costs you nothing. The download button writes a copy back out
  wherever you choose, for sending a schedule on to a client.
- PDF, PNG, JPG and WEBP, up to 20 MB each. The same file cannot land on one
  client twice, matched on its contents rather than its name.
- Deleting a client takes their paperwork with them. Deleting a policy does not:
  last year's schedule stays on the client.

## 0.2.0 — 15 August 2026

### Reminders

- **The app writes to your clients before their cover runs out.** A ladder of
  rules — 60, 30, 15, 7 and 1 day before expiry out of the box, with a
  week-after chaser you can switch on — decides who hears from you and when.
  Change any rung, switch one off, add your own, or limit one to a kind of
  cover.
- **Write the messages in the app.** The editor fills your wording in with a
  real policy from your book as you type, so you read what the client will read,
  and it points at a placeholder you have misspelt before it can reach anyone.
- **Mail goes out through your own mailbox** under **Settings → Sending email**,
  so replies come back to you and nobody else holds your client list. **Send
  test** proves the details before a client depends on them. The password is
  kept in your computer's password manager, never in your book or a backup.
- **It starts in practice mode.** Everything is worked out and nothing is sent,
  so you can read a week of messages before switching sending on.
- **A daily run at a time you choose**, whether or not the window is open. A
  computer that was asleep at nine catches up when you open it, and still only
  runs once.
- **The Reminders screen** shows what is due today, your rules, your messages,
  and what happened to every message. Anything that failed can be sent again.
- Nobody gets the same reminder twice, clients who asked not to be contacted are
  left out, clients with no address are reported rather than passed over in
  silence, renewing a policy calls off the reminders queued for it, and what is
  over your daily limit waits for tomorrow.

### Updates

- **The app keeps itself up to date.** It looks for a new version when you open
  your book, and says so only when there is one. **Install now** fetches it,
  replaces the app and offers to restart; **Later** asks again next time.
- No trip back to the downloads page, and none of the unknown-publisher warnings
  you clicked through when you first installed. Your book, your backups and your
  settings are untouched.
- Nothing appears when you are already up to date or the machine is offline.
- The version you are running is at the foot of Settings, and is now the real
  one rather than a number written into the screen.

If you are on 0.1.0, install this version by hand from the releases page once.
Every version after it arrives on its own.

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
  https://laksagent-png.github.io/StayInsured/guide.

### Still to come

Automatic reminder emails, stored policy documents, claims tracking, the
printable report pack, and separate logins for staff. Each is planned, and none
of them is switched on in this version.

