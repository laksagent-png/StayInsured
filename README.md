# StayInsured

StayInsured keeps your client book, every policy you have placed, and every
renewal date in one place on your own computer. It tells you what is about to
lapse, holds the full history of each policy year after year, and hands you a
list of who to contact this week.

Nothing is uploaded anywhere. There is no account, no subscription and no
internet connection required. Your book sits in an encrypted file on your
machine that only opens with your password.

Every operation, one page each and with pictures, is in the
[agent's guide](docs/guide/index.md). This page is the short version.

Runs on macOS and Windows. Building from source, or working on the app itself, is
covered in [DEVELOPER.md](DEVELOPER.md), with the architecture and command
reference in [docs/](docs/README.md).

---

## Installing

Go to the [releases page](https://github.com/laksagent-png/StayInsured/releases)
and download the file for your computer.

**On a Mac** — open the `.dmg` and drag StayInsured into your Applications
folder. The first time you open it, **right-click the app and choose Open**, then
confirm. Do not double-click it the first time: macOS blocks apps it has not seen
before and a double-click gives you a warning with no way past it. Right-clicking
gives you an Open button. You only do this once.

**On Windows** — run the `.exe` installer. Windows will say the publisher is
unknown. Choose **More info**, then **Run anyway**.

Both warnings appear because the app is not registered with Apple and Microsoft,
which costs money each year. They are not a sign that anything is wrong.

## Setting up, the first time

The app asks for two things:

1. **Your agency name** — appears in the app and, later, in the emails you send.
2. **A password** — this creates your encrypted book.

**Read this before choosing the password.** The password is the only key to your
data. It is not stored anywhere, not by us and not on your computer, so nobody
can look it up or reset it for you. If you forget it and you have not ticked the
option below, your client book cannot be recovered. Write it down and keep it
somewhere safe, the same way you would treat the keys to a filing cabinet.

You will be offered **Remember on this device**. Ticking it lets your computer's
own password manager (Keychain on Mac, Credential Manager on Windows) hold the
key, so opening the app is a single click. Leave it unticked if the machine is
shared, and you will type your password each time.

## Opening it day to day

Launch the app, unlock, and you land on the dashboard.

Closing the window does **not** quit the app. It keeps running in the menu bar
(Mac) or system tray (Windows), so scheduled work carries on. To quit properly,
click the tray icon and choose Quit.

---

## The seven screens

**Dashboard** — the state of your book at a glance: how many clients, how many
live policies, what expires in the next stretch, the premium you manage, your
commission, and the split across health, life, motor and the rest. Every number
is clickable and takes you to the list behind it.

**Renewals** — your working list, and the screen you will live in. See below.

**Clients** — everybody in your book. Search by name, phone, email, client code
or PAN. Narrow by city, by the kind of cover they hold, by who has no email
address on file, or show archived clients.

**Client page** — one client in full: contact details, the family members covered
under their policies, and every policy they hold, past and present.

**Policies** — every policy you have placed, searchable by policy number, client
name or vehicle number, filterable by category, status and expiry window.

**Import** — bring an existing spreadsheet in. See below.

**Insurers** — the list of insurance companies and their plans. Keeping this tidy
means "HDFC Ergo" does not end up recorded three different ways.

**Settings** — your agency details, your password, backups, and where your data
lives.

---

## Getting your existing book in

If you already track clients in Excel, you do not need to retype anything.

1. Open **Import** and click **Download template**. You get a spreadsheet with
   every column the app understands, so you can see the shape it expects.
2. Either fill in the template, or just point the app at the spreadsheet you
   already keep — it does not have to match the template. Click **Choose file**
   and pick your `.xlsx`, `.xls` or `.csv`.
3. The app reads your column headings and guesses which is which. Check its
   guesses on the **Match your columns to fields** panel and correct any it got
   wrong. Four fields must be matched before it will run: **client name**,
   **policy number**, **insurer** and **expiry date**. Everything else is
   optional.
4. Click **Check without saving**. This reads the whole file and reports exactly
   what it would do, listing every row it cannot make sense of and why, without
   changing anything at all. Fix your spreadsheet and check again as many times
   as you like.
5. When the report looks right, click **Import for real**.

Things worth knowing about how it reads a file:

- **It will not create duplicates.** Clients are matched on client code first,
  then email, then phone, then name. Import the same file twice and the second
  run changes nothing.
- **A policy is identified by its insurer plus policy number.** Tick *update
  existing* if you want a re-import to refresh policies already recorded.
- **Blank fields get filled in, filled fields are left alone.** A second import
  can add the phone numbers you were missing without overwriting anything.
- **Dates can be written the usual ways** — `31/03/2026`, `2026-03-31`, or a real
  Excel date. Money can carry symbols and commas: `₹10,00,000` and
  `Rs. 24,500.50` both read correctly.
- **The kind of cover is worked out from your wording.** "Mediclaim" and "family
  floater" become Health, "term plan" becomes Life, "two wheeler" becomes Motor,
  "overseas" and "student" become Travel. Correct anything it gets wrong
  afterwards.
- **A row that fails is skipped whole.** It never leaves a half-created client
  behind.

---

## Working the renewals

The **Renewals** screen groups policies by how soon cover stops: **Overdue**,
then the next **7**, **30**, **60** and **90 days**. Work down from the top.

Three buttons at the top right:

- **Recalculate** — rechecks every policy against today's date. Statuses move on
  their own, but this forces it, which is handy first thing in the morning.
- **Copy emails** — copies the email addresses of everyone in the list you are
  looking at, ready to paste into your mail program. Clients who have asked not
  to be contacted are left out automatically.
- **Export** — saves the list as Excel or CSV.

To renew a policy, click **Renew** on its row. Last year's details are filled in
for you; change the premium, dates or sum insured as needed and save.

**This is the important part:** renewing does not overwrite last year. It creates
the new policy year and links it to the old one, so you keep the full history —
what they paid in each year, when cover ran, what changed. Click **History** on
any policy to see the whole chain.

## Several policies for one person

One client holds as many policies as they need — health, life, motor, travel, all
under the same name, each with its own number, insurer, premium and expiry date.
Their client page lists all of them together, and the renewals list treats each
separately, because each falls due at its own time.

Family members covered under a policy are recorded on the client too, so you know
who is on the family floater without opening the paperwork.

---

## Reminders, and what works today

Automatic reminder emails are being built and are not switched on yet. What you
have today is the **Renewals** screen plus its **Copy emails** button, which gets
you a ready-made recipient list in a few seconds.

The settings for the automatic version are already there under
**Settings → Reminders** — what time of day to send, how many to send per day,
whether to start the app at login — and what you save now will be used when
sending is switched on. Filling them in early does no harm.

## Backups

Your data lives in one encrypted file, so backing up means copying that file.

Under **Settings → Data & backups** you can **Back up now** at any time, and set
**Copy backups to** — a folder of your choosing. Point it at your Google Drive or
Dropbox folder and every backup is carried off the machine automatically, which
covers you if the computer is lost or stolen. Backups are encrypted with the same
password, so they are safe to keep in cloud storage.

**Reveal data folder** opens the folder holding everything, which is what you
copy to move to a new computer.

## Settings worth knowing

- **Agency name, contact email, phone, address** — used in the app and in client
  emails later.
- **Expiring soon window** — how many days ahead counts as "expiring soon" on the
  dashboard. Set it to how far ahead you actually start chasing renewals.
- **Currency** — Indian rupees by default.
- **Change password** — needs your current one. Do this away from month-end;
  the book is re-encrypted as part of it.
- **Show desktop alerts** — a notification about the day's expiries.

---

## Questions

**Can I use this on two computers?** Not at the same time, sharing one book. Each
installation keeps its own data. Copying the data folder across moves the book,
which works well for replacing a machine.

**Can my assistant have their own login?** Not yet. The app is built for one
person today, and multiple logins are planned.

**Is my data on the internet?** No. It never leaves your computer unless you
point backups at a cloud folder yourself.

**What if I forget my password?** If you ticked "remember on this device", that
computer can still open the book, and you should change the password to something
you will keep. If you did not, the data cannot be recovered by anyone. This is
the unavoidable other side of it being properly encrypted.

**Will updating lose my data?** No. Installing a newer version replaces the app,
not your book.

**Something looks wrong.** Please open an issue at
https://github.com/laksagent-png/StayInsured/issues describing what you did and
what happened. If it involves a spreadsheet import, say which column upset it,
but do not attach a file containing real client details.

## Still to come

Being honest about what is not built yet: automatic reminder emails with editable
templates, the printable report pack, storing scanned policy documents against a
client, claims tracking, and logins for more than one person.
