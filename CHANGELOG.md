# Release notes

Upgrading replaces the app and never the data: your book, your backups and your
settings survive every version below.

## Upcoming

## 0.8.0 — 29 August 2026

### Added

- **A motor policy now records the vehicle and both covers.** Choose Motor and the
  form asks what a motor proposal asks: what kind of vehicle it is, who built it,
  the model and the year, the registration, engine and chassis numbers, and which
  covers the schedule sold. A goods carrying vehicle is asked its gross weight and
  a passenger vehicle how many it seats; nothing else is asked either. The vehicle
  used to live in your notes, where you could not search it or sort by it.

  Own damage and third party are recorded separately, each with its own dates and
  its own premium, and the cover type decides which of the two you are asked for —
  a liability policy is not asked about own damage, a standalone OD policy not
  about third party. The premium fills itself in from the two added together
  unless you type your own.

  **A motor policy has no start and expiry date to fill in any more.** It runs for
  as long as its first cover does, so the dates come from the covers themselves.
  A 1+3 bundle turns up on your renewals desk after a year — when the own damage
  cover actually has to be bought again — instead of sitting quiet for three
  years.

  Searching finds a policy by its engine or chassis number as well as by its
  registration number, so a claim that arrives quoting one of them and nothing
  else reaches the right policy. The policy export gained a column for every new
  field.

  Renewing keeps the vehicle and asks you to restate the risk: next year comes
  back with the same vehicle and the same cover type, and with the cover dates and
  premiums empty, because those described last year. Fill them in on the new year
  once the schedule arrives.

  Motor policies already in your book keep their registration number and show the
  new questions blank until you edit them.

### Fixed

- **Renewing no longer loses the proposal detail when you clear a figure.** If you
  emptied the sum insured, premium, GST or commission box while recording a
  renewal, the new year came back without the variant, riders, plan type, term,
  policy type, broker and inbuilt rider that renewing had just carried over. They
  are kept now, along with the vehicle on a motor policy.

## 0.7.0 — 29 August 2026

### Changed

- **A group's head is a contact you write down, not a client you have to enter.**
  The person who sends you work is usually a broker, an HR manager or an
  accountant — somebody you ring and never insure — and recording one used to mean
  opening a client for them, where they padded your client count, sat in your
  clients list holding no policies, and came out in every export as a
  policyholder with nothing to their name. A group now carries their **Group
  head**, **Designation**, **Phone** and **Email** in four plain boxes, and all
  four may be left empty: open the group when you know which firms belong
  together and fill the head in when you find out. **Edit head** on the head card
  is where you do that. Searching groups still finds them by the head's name.

  Every group you already have keeps its head. The name, phone number and email
  of the client who was down as the referrer are copied onto the group, so the
  only thing you lose is the link from the group to that client's page — and the
  *Group head of N groups* list on a client's page, which no longer means
  anything.

- **The client form can file a client into a group while you enter them.** A
  **Group** box lists your groups and starts on **No group**. Choose **Open a new
  group…**, type a **New group name**, and the group is opened and the client
  filed into it when you save. Typing the name of a group you already have joins
  that one rather than opening a second. **New company** on a group's page starts
  the form already filed in that group.

## 0.6.0 — 28 August 2026

### Added

- **A company can be a client, and companies can be filed into a group.** The
  client form now asks whether you are entering a person or a firm. Choose
  **Company** and the date of birth and gender give way to the things you
  actually hold for a firm: the person you deal with, their designation, the
  GSTIN and the registration number. Everything else is unchanged — a company
  holds policies, turns up in renewals, gets reminders and exports like anybody
  else.

  A **Groups** screen sits beside Clients. A group is one employer's book kept
  together — the parent company, its subsidiaries, the sister concern — and it
  records the client who introduced them as its **group head**. The group's page
  totals the members' policies and premium, shows the next expiry across all of
  them, and lists who is in it; the head sits at the top with a link to their own
  page, and their page lists the groups they brought in.

  This is not a family, and it does not behave like one. Sharing a group relates
  nobody to anybody: a policy still only covers the client who holds it or one of
  their relatives, so nothing about filing two firms together lets one insure the
  other's staff. Archiving a group puts its members away and leaves the head
  alone; deleting one keeps every company standing and merely unfiles them.

  Nothing changes for a book that has no companies in it. Every client you
  already have is a person in no group, which is exactly what they were before.

- **Import and export carry the type, the group and the corporate details.** A
  spreadsheet with a **Client type** column brings your firms in as firms —
  "Pvt Ltd", "Corporate", "Partnership firm" and "LLP" are all read as one — and
  a **Group** column files the rows into groups, opening one the first time it
  sees the name and putting the rest in the same one. A group that arrives this
  way has nobody down as its head, because a spreadsheet knows who is grouped
  together and not who introduced them; the group's page asks you for the name
  when you have it.

  Two things it will not do. It never guesses a firm from its name, so
  "Sharma & Sons" is a company only if the column says so. And a later file can
  promote a client to a company but never demote one, so the retail sheet listing
  a firm's director does not turn the firm back into a person.

  Headings you already use keep their old meanings: **Type** is still the policy
  category, **GST** still the tax, **Registration No** still the vehicle. Spell
  them out — **Client type**, **GSTIN**, **Registration number** — when you mean
  the company's. The client export gained the same columns, so a book exported
  and re-imported comes back whole.

## 0.5.0 — 28 August 2026

### Added

- **The policy form asks a health policy what a health proposal asks.** Choose
  Health and the form comes back in the order the insurer's own form reads —
  category, client, policy number, insurer, plan, variant, riders, individual or
  floater, term, risk dates, policy type, sum insured, premium, broker, inbuilt
  rider — with your own bookkeeping below it. Seven of those are new: the plan's
  variant, the riders bought on top, individual or family floater, the years
  bought in one go, whether the year is fresh, ported or renewed, the broker it
  was placed through, and the rider the plan already carries.

  All of it is required for a health policy, because a policy recorded without
  its variant, riders and term cannot be quoted or renewed from your book. The
  other categories are unchanged, and pick up nothing they do not ask for.

  Choosing a term of two years or more works out the risk end date to match, and
  renewing later runs the new year for that same term rather than one. A policy
  ported in from another insurer keeps saying so, while the year it renews into
  says renewal.

  Policies already in your book are untouched — the new questions are simply
  blank on them, and stay blank until you edit the policy.

- **The Windows 7 edition offers its own updates now.** It used to be the one
  edition you had to keep up to date by hand: it would check for a new version on
  launch, find nothing because it had nowhere to look, and say nothing. It now
  looks in the right place and offers the new version the same way the main app
  does, with the same wording and the same once-a-launch manners.

  It will only install a release this project signed, and only after checking that
  what it downloaded is the file that was signed — worth knowing because, unlike
  the main app, nothing about these installers is vouched for by Windows itself.
  Choosing to install opens the familiar installer window and closes the app, since
  Windows cannot replace a program while it is running.

  One machine at a time still needs a hand: a copy of 0.0.6 or older has no way to
  check a signature, so it will find the new version and decline it. Update those
  by hand once, and they keep themselves current afterwards.

### Fixed

- **The Windows 7 edition's Mac disk images no longer look like broken
  downloads.** These are the developer builds — they exist so the packaged app can
  be opened on a Mac, and they are not how anyone runs StayInsured — but macOS was
  calling a downloaded one *damaged* and offering to move it to the Bin, with no
  way past it. The file was fine; it was missing part of its signature. Downloaded
  copies now give the usual "cannot be checked for malicious software" message,
  which has an **Open Anyway** button behind it in Privacy & Security.

## 0.4.0 — 22 August 2026

### Changed

- **The people on a family floater are clients now, not entries inside one.** A
  wife, a son, a father — each is somebody in your book, with their own client
  code, their own page, and their own policies if they ever buy one. They are
  linked to the policyholder as spouse, son, mother and so on, and the link reads
  correctly from either page: **Son** on the father's, **Son of** on the son's.
  Your existing families are moved across when you open this version. Nothing is
  asked of you, and nobody who was on file is lost — where a family member turned
  out to be someone already in your book under the same name, the two are joined
  rather than duplicated, and anything the member's record held that the client's
  did not, such as a date of birth, is kept.

  The day a son buys his own two-wheeler policy, he is therefore already a client
  and the policy just goes against him. Nothing is re-typed and his place in the
  family stays.

- **The clients list browses the people who hold the cover.** Otherwise a book of
  two thousand policyholders would list several thousand names. Anybody covered
  under somebody else's policy, with none of their own, is marked **Family member**
  and kept back until you tick **Include family members** — but searching by name
  always finds them, and the dashboard's client counts are counts of
  policyholders, so the "no email address" figure no longer counts children.

### Added

- **A client's page shows the family, and links to each of them.** **Link
  relative** finds somebody already in your book or opens a client for somebody
  new, at the same address. Each row says how they are related, whether they hold
  cover of their own, and unlinking one removes only the link — the person stays
  in your book.

- **A household can be archived or deleted together.** **Archive family** on a
  client's page moves them and the people linked to them at once. Deleting now
  asks which you meant: this client alone, leaving their relatives standing as
  clients, or this client and the people linked to them. Both reach one step out
  and stop, so an in-law's own parents are never swept up.

- **A policy names the lives it covers, by client.** Only the policyholder and the
  people related to them can be ticked, and renewing carries the same lives into
  the new year.

- **Importing reads how the people on a floater are related, instead of leaving
  every one of them as "other".** If your covered-members column writes the word
  the way a register does — *Priya Sharma (Wife)*, *Wife - Priya Sharma*, *Priya
  Sharma - wife* — that is how they are recorded. Where it gives a bare name that
  is also the policy's nominee, the relationship comes from **Nominee relation**.
  *Self*, *Proposer* and *Insured* are understood to mean the policyholder.

  Those words also no longer end up inside people's names: a file saying *Priya
  Sharma (Wife)* used to put a client called "Priya Sharma (wife)" in your book,
  and one saying *Self* used to add a second copy of the policyholder. Correcting
  that column and importing the file again fixes the relationships across your whole
  book at once — it puts back what the file says, and leaves anything you set by
  hand where the file is silent.

## 0.3.5 — 17 August 2026

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

- **Attaching a document you already attached says so in plain words.** Picking the
  same scan twice for one client was refused, correctly, but the refusal read
  "UNIQUE constraint failed: documents.client_id, documents.sha256", which tells you
  nothing about what you did or what to do next. It now says the file is already
  attached to this client. Both editions were affected and both are fixed.

- **Opening StayInsured twice brings you back to the copy you already have.**
  Double-clicking the shortcut while the app was running — or opening it yourself
  after it had started itself at login and gone to the tray — used to give you a
  second app on the same book. Two of them saving the same clients is how a
  client added in one goes missing in the other, and how a morning's reminders
  go out twice. A second launch now brings the window you already have forward,
  whether it was on screen or waiting in the tray, and nothing else opens.

### Added

- **The Windows 7 edition does the whole job now.** It reads spreadsheets in, writes
  your book out to Excel or CSV, keeps policy documents beside the client they belong
  to, and sends the renewal reminders itself from your own mail server. Nothing in it
  says "not built" any more. Reminders stay switched off and in dry-run until you
  fill in the mail server, so nothing reaches a client before you have read what it
  would say — and a machine that was switched off on the day a reminder was due
  sweeps once when it comes back, rather than sending every day it missed. It also
  lives in the notification area, locks from there, and hands a second launch to the
  copy already running instead of opening your book twice. It still does not encrypt
  the file; that has not changed and is not going to.

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

