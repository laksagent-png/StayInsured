# StayInsured

StayInsured keeps your client book, every policy you have placed, and every
renewal date in one place on your own computer. It tells you what is about to
lapse, holds the full history of each policy year after year, writes to the
clients whose cover is running out, and hands you the list of who to call.

Nothing is uploaded anywhere. There is no account and no subscription. Your book
sits in an encrypted file on your machine that only opens with your password,
and reminders go out through your own mailbox rather than through us.

Every operation, one page each and with pictures, is in the
[agent's guide](docs/guide/index.md). This page is the short version.

Runs on macOS and on Windows 10 version 1803 or newer. Building from source, or
working on the app itself, is covered in [DEVELOPER.md](DEVELOPER.md), with the
architecture and command reference in [docs/](docs/README.md).

---

## Installing

Go to the [releases page](https://github.com/laksagent-png/StayInsured/releases)
and download the file for your computer.

**On a Mac** — open the `.dmg` and drag StayInsured into your Applications
folder. Opening it the first time is refused: macOS blocks apps it has not seen
before, and the warning it shows has no Open button on it. Getting past it takes
one trip to **System Settings → Privacy & Security**, where a line saying
StayInsured was blocked sits near the bottom with an **Open Anyway** button
beside it. Press that, confirm, and the app opens. You do this once.

On macOS 14 and earlier, **right-click the app and choose Open** instead, which
gives you an Open button there and then. Apple removed that shortcut in macOS 15.

**On Windows** — run the `.exe` installer. Windows will say the publisher is
unknown. Choose **More info**, then **Run anyway**.

Windows 10 version 1803 is the oldest version the app runs on. On Windows 7, 8
and 8.1 the installer stops and says so rather than installing something that
cannot open: the app draws its screens with the Microsoft Edge WebView2 runtime,
and Microsoft ended WebView2 support for those versions in January 2024.

Both warnings appear because the app is not registered with Apple and Microsoft,
which costs money each year. They are not a sign that anything is wrong.

## Staying up to date

The app looks for a new version when you open it, and tells you only when there
is one. Choose **Install now** and it downloads the update, replaces itself and
offers to restart — no going back to the releases page, and no warnings to click
through the way the first install had. Choosing **Later** simply asks again next
time.

Version 0.1.0 came out before this existed, so if that is what you are running,
install a newer version by hand once from the releases page. Every version after
it updates itself.

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

## The eight screens

**Dashboard** — the state of your book at a glance: how many clients, how many
live policies, what expires in the next stretch, the premium you manage, your
commission, and the split across health, life, motor and the rest. Every number
is clickable and takes you to the list behind it.

**Renewals** — your working list, and the screen you will live in. See below.

**Reminders** — what the app writes to your clients, when, and what happened to
each message. See below.

**Clients** — everybody in your book. Search by name, phone, email, client code
or PAN. Narrow by city, by the kind of cover they hold, by who has no email
address on file, or show archived clients and family members.

**Client page** — one client in full: contact details, the family they belong to,
every policy they hold, past and present, and the scanned paperwork behind them.

**Policies** — every policy you have placed, searchable by policy number, client
name or vehicle number, filterable by category, status and expiry window.

**Import** — bring an existing spreadsheet in. See below.

**Insurers** — the list of insurance companies and their plans. Keeping this tidy
means "HDFC Ergo" does not end up recorded three different ways.

**Settings** — your agency details, your password, backups, your mail server, and
where your data lives.

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

The people covered under a policy are clients in their own right, linked to the
policyholder as spouse, son, mother and so on. So you know who is on the family
floater without opening the paperwork — and the day the son buys his own
two-wheeler policy, he is already somebody in your book rather than a name typed
inside his father's record.

Browsing the clients list shows the people who hold the cover; **Include family
members** brings in everybody else, and searching by name always finds them.

## The paperwork itself

The **Documents** panel on a client page holds the scans: the policy schedule,
the signed proposal, the RC book, the PAN card. Attach a PDF or a photograph, say
which policy it belongs to, and it opens in the app whenever you need it. The app
takes a copy rather than moving your file, so tidying your Downloads folder later
costs you nothing.

They go **inside your encrypted book**, not into a folder beside it. That means
your backup carries them, your password protects them, and moving to a new
computer moves them too — there is no second pile to remember. Files can be PDF,
PNG, JPG or WEBP, up to 20 MB each, and the same file cannot be attached to one
client twice.

The download button on any row writes a copy wherever you choose, which is how
you send a schedule on to a client.

---

## Reminders

The app can write to your clients before their cover runs out, so chasing a
renewal is something you check rather than something you do.

Out of the box it writes 60, 30, 15, 7 and 1 day before expiry, with a
week-after-expiry chaser that ships switched off in case you would rather make
that one a phone call. Each rung of the ladder is a rule you can change, switch
off or add to, and each one sends a message you can rewrite. The editor shows the message filled in with a real policy from your
book as you type, so you see what the client sees.

Mail goes out through **your own mailbox**, over your provider's mail server, so
replies come back to you and no third party ever holds your client list. Put the
details in under **Settings → Sending email** and press **Send test** to prove
it works. Most providers need an app password rather than your normal one.

**It starts in practice mode.** Everything is worked out and nothing is sent,
which lets you read a week of messages before a single client receives one. When
the wording and the timing look right, turn practice mode off and switch
reminders on.

A few things it does so you do not have to think about them: a client only ever
gets one copy of a given reminder, however often the app runs; anybody who has
asked not to be contacted is left out; a client with no email address is
reported rather than silently skipped; renewing a policy calls off the reminders
still queued for it; and if your provider limits how much you can send in a day,
the rest waits for tomorrow rather than being lost.

The **Reminders** screen shows what is due today, the rules, the messages, and
the history of every message with what happened to it. Anything that failed can
be sent again from there.

If you would rather write to people yourself, the **Renewals** screen and its
**Copy emails** button are still there.

## Backups

Your data lives in one encrypted file — clients, policies, settings and every
scan you have attached — so backing up means copying that file.

Under **Settings → Data & backups** you can **Back up now** at any time, and set
**Copy backups to** — a folder of your choosing. Point it at your Google Drive or
Dropbox folder and every backup is carried off the machine automatically, which
covers you if the computer is lost or stolen. Backups are encrypted with the same
password, so they are safe to keep in cloud storage.

**Reveal data folder** opens the folder holding everything, which is what you
copy to move to a new computer.

## Settings worth knowing

- **Agency name, contact email, phone, address** — used in the app and in the
  emails your clients receive.
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
point backups at a cloud folder yourself. The one connection the app makes is to
your own mail server when it sends a reminder, and that carries the message, not
your book.

**What if I forget my password?** If you ticked "remember on this device", that
computer can still open the book, and you should change the password to something
you will keep. If you did not, the data cannot be recovered by anyone. This is
the unavoidable other side of it being properly encrypted.

**Will updating lose my data?** No. An update replaces the app, not your book.
Your clients, policies, settings and password are untouched.

**Something looks wrong.** Please open an issue at
https://github.com/laksagent-png/StayInsured/issues describing what you did and
what happened. If it involves a spreadsheet import, say which column upset it,
but do not attach a file containing real client details.

## Still to come

Being honest about what is not built yet: the printable report pack, premium and
commission records, claims tracking, and logins for more than one person.
