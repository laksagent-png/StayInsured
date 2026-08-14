# StayInsured — the agent's guide

StayInsured holds your whole book — clients, the people they cover, every
policy year and every renewal date — in one encrypted file on your own computer.
There is no account and no subscription, and the only time the app goes online
is to send a reminder through your own mailbox.

This guide is written one operation to a page. Find the job you are doing, read
that page, and get back to work.

![Dashboard](screenshots/dashboard.png)

## Start here

If the app is new to you, read these three in order and you are running.

| # | Page | What you will do |
| --- | --- | --- |
| 1 | [Install and first run](install-and-first-run.md) | Install the app, create your encrypted book, unlock it each day |
| 2 | [Import your book](import-your-book.md) | Bring years of spreadsheet history in without retyping it |
| 3 | [Work the renewals](renewals.md) | Chase what expires this week and record each renewal |

## Every operation

**Daily work**

| Page | Covers |
| --- | --- |
| [Find your way around](getting-around.md) | The eight screens, search, the badges, and how to read the dashboard |
| [Work the renewals](renewals.md) | The urgency tabs, recalculate, copy emails, record a renewal, read the history |
| [Send the reminders](reminders.md) | The ladder, the wording, the daily run, and what happened to each message |

**The book**

| Page | Covers |
| --- | --- |
| [Manage clients](clients.md) | Add, find, edit, archive, delete and export clients |
| [Record insured members](insured-members.md) | The people covered under a family floater or travel policy |
| [Keep the paperwork](documents.md) | Attach scans and photographs to a client or a policy, and read them back |
| [Manage policies](policies.md) | Record a policy, every field on the form, filters, statuses, deleting |
| [Insurers and plans](insurers-and-plans.md) | Keep one company recorded one way, and its plans beneath it |

**Setting up and keeping safe**

| Page | Covers |
| --- | --- |
| [Install and first run](install-and-first-run.md) | Installing, creating the book, unlocking, locking, quitting |
| [Import your book](import-your-book.md) | The full column list, matching rules, the dry run, and what to do when a row fails |
| [Settings](settings.md) | Agency details, the expiring-soon window, changing your password, reminders and your mail server |
| [Backups and your data](backups-and-data.md) | Take a backup, restore one, move the book to another computer |

**Look it up**

| Page | Covers |
| --- | --- |
| [Reference](reference.md) | Categories, statuses, keyboard shortcuts, where the data lives, questions |

## What the app guarantees

- **Your book never leaves the machine.** The database is encrypted with your
  password and nothing is uploaded. Reminders go out through your own mailbox,
  so the only thing that ever crosses the wire is the message you wrote.
- **Renewing never overwrites.** Each policy year is kept as its own record, so
  what a client paid three years ago is still there.
- **Statuses follow the calendar.** Expiring, expired and lapsed are worked out
  from today's date, not typed in by you.
- **An import tells you what it will do first.** You check the whole file
  without saving anything, and commit only when the report reads right.

---

Building StayInsured rather than using it? The architecture, command contract
and database schema live in
[docs/technical](https://github.com/laksagent-png/StayInsured/tree/main/docs/technical).

<sub>Every screen in this guide is photographed from the running app against a
demo book, and is regenerated whenever the interface changes.</sub>
