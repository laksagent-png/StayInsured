# Release notes

Upgrading replaces the app and never the data: your book, your backups and your
settings survive every version below.

## Upcoming

### Added

- **The Windows 7 edition does most of the job now.** It reads spreadsheets in,
  writes your book out to Excel or CSV, keeps policy documents beside the client
  they belong to, and lets you write the reminder ladder and the messages it sends.
  Two things there still say "not built" when you reach them: working out which
  reminders are due today, and sending them. It also lives in the notification area
  now, locks from there, and hands a second launch to the copy already running
  instead of opening your book twice.

## 0.3.4 — 17 August 2026

### Fixed

- **Saving a client no longer fails with "database disk image is malformed".**
  Adding something a client did not have on file — a PAN, an email address, a
  longer name — could be refused outright with a message about the database being
  damaged, which it never was. It hit hardest on a book that had just been
  started, and on filling in a column nobody in the book had filled in yet, and it
  took an import down with it: a spreadsheet that would have completed the records
  you already had reported those rows as failures and dropped their policies. That
  is fixed, and opening the app once rebuilds your client search so it agrees with
  your book again. Nothing is asked of you and nothing was lost.

### Changed

- **The setup and security screens only promise encryption where there is some.**
  They still say what they always said in this app, because this app does encrypt
  your book. There is now a separate edition for Windows 7 machines, which cannot,
  and the same screens tell whoever is using it plainly: the password locks the app,
  but anyone who can copy the file can read the clients in it. Being told your data
  is encrypted when it is not is how a laptop ends up somewhere it should not.

## 0.3.3 — 16 August 2026

### Fixed

A pass over every screen, prompted by writing a test for each one. The tests
found around 130 faults; these are the ones you would have noticed.

- **The rest of the app keeps up with what you just did.** Renewing a policy,
  archiving a client or adding a plan used to leave the other screens showing
  the old figures until you went away and came back — the tab counts, the
  sidebar badge, the dashboard and the client's own page could all disagree
  with each other. Every screen now takes a change as it happens.

- **A screen that cannot read your book says so.** When something went wrong
  reading the database, most screens simply showed nothing, which looks exactly
  like a book with nothing in it: you were invited to add clients you already
  had, or to clear filters you had never set. A failed read now says what went
  wrong and offers **Try again**, and an empty list says it is empty.

- **Forms catch a mistake before saving it.** Dates that are not real dates or
  fall in the wrong order, amounts that are not numbers, an email address that
  is not one — these went to the database and came back as an error from deep
  inside the app, or worse, were saved. They are now refused where you are
  working, with a plain explanation, before anything is written. **Enter** saves
  the client, policy and renewal forms from any box — in the policy form's
  client search it picks the closest match instead — and **Escape** closes a
  dialog.

- **A row the import cannot read now names the cell.** "Rows needing attention"
  told you the row number and the reason; it now names the column and quotes
  what was in it, so a bad date in a book of two thousand rows is something you
  can find. Correcting the mapping after a check also puts the report aside, so
  an import can no longer be committed against a check that no longer applies.

- **Editing a client no longer clears the details the form does not show.**
  Saving from a shortened form could quietly empty fields you had filled in
  elsewhere.

- **Searching, filtering and paging behave.** Searching from the top of the
  window now works even when you are already on the screen you are searching;
  changing a filter or the sort order takes you back to the first page instead
  of stranding you in the middle of a new list; clearing a search box removes
  the filter rather than searching for nothing; and the pager can no longer run
  past the last page.

- **Lists can be driven from the keyboard.** Column headings sort with Enter or
  Space and rows open the same way, and a screen reader now says which column
  the list is sorted by.

- **Counts and figures read properly.** "1 rule" instead of "1 rules", a
  negative amount as -₹5L rather than ₹-5L, and file sizes that round the way a
  file manager rounds them.

- **Policies.** The **Status** box in the policy form is properly labelled, so
  cancelling a year works with the keyboard and with a screen reader, and the
  filters along the top of the list now say what each one is for.

- **Renewals.** Recalculating tells you what it changed instead of finishing in
  silence.

- **A cancelled year stays cancelled after you renew it.** If a client cancelled
  and later came back, renewing the cancelled year used to mark it **Renewed**,
  and the book then had no record that the cover was ever ended early. It keeps
  saying **Cancelled** now, while the new year goes on record as usual.

- **A policy year cannot be renewed twice.** Nothing but the buttons on screen
  stopped a second renewal being written against the same year, which would have
  left one policy with two current years pulling the counts and the renewals
  desk in different directions. Renew the latest year of a policy; the app says
  so if you reach an older one.

- **Insurers and plans.** Removing a company now takes its plans with it rather
  than leaving them behind with no owner; a plan must belong to a company; the
  plans table shows whether a plan is in use; and an insurer row shows the
  support email and website you recorded.

- **Reminders.** A new rule joins the ladder at the bottom instead of jumping to
  the top; a rule that writes to a client will not save without a message
  chosen, and a message will not save without a subject; and the history can be
  searched and sorted by date.

- **Settings.** The four numeric boxes state the range they accept and refuse
  anything outside it instead of storing a number the app then ignores; **Save
  changes** stays greyed out until you have actually changed something, and goes
  out again if you undo an edit by hand; what you have typed survives a save in
  progress; **Send test** checks the address before it writes anything; and a
  stored mail password can be removed.

- **A member opens by name.** Clicking an insured member's name opens their
  details, the way clicking a policy row opens the policy, so a family can be
  worked through from the keyboard. Member and document names now underline
  under the pointer, so it is clear they open something.

- **The unlock screen.** Unlocking with an empty box says so rather than asking
  the database, and the form stays usable while your keychain is still thinking.

- **Documents.** The two buttons on a row name the document they act on — **Save
  a copy of Policy schedule 2025-26**, **Remove Policy schedule 2025-26** — on
  hover and to a screen reader, and a document that cannot be opened says why
  instead of showing an empty viewer.

## 0.3.2 — 16 August 2026

### Changed

- **The Windows installer tells you when a computer is too old.** Windows 10
  version 1803 is the oldest version the app runs on. On Windows 7, 8 and 8.1 the
  installer now explains that and stops without touching the machine, instead of
  installing an app that closes the moment you open it.

## 0.3.1 — 16 August 2026

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

