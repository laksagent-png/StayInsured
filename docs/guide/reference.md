[← Guide contents](index.md)

# Reference

The lists and answers you look up rather than read.

- [Categories](#categories)
- [Statuses](#statuses)
- [Keyboard](#keyboard)
- [Client codes](#client-codes)
- [Exports](#exports)
- [Still to come](#still-to-come)
- [Questions](#questions)

## Categories

Health · Life · Motor · Travel / International · Home · Personal Accident ·
Critical Illness · Other

Every policy carries exactly one. Categories drive the dashboard's mix, the
filters on the [clients](clients.md) and [policies](policies.md) screens, and
which fields appear on the policy form — **Vehicle number** shows for motor. The
list of lives covered appears whenever the client has a [family](families.md) on
file, whatever the category.

An [import](import-your-book.md) works the category out from your wording:
"mediclaim" and "family floater" become Health, "term plan" Life, "two wheeler"
Motor, "overseas" Travel.

## Statuses

| Status | Set when | Set by |
| --- | --- | --- |
| **Active** | The expiry date is today or later | The calendar |
| **Expired** | Expiry passed within the last 30 days, nothing replacing it | The calendar |
| **Lapsed** | Expiry passed more than 30 days ago, nothing replacing it | The calendar |
| **Renewed** | A later policy year exists in the chain | Recording a renewal |
| **Cancelled** | Cover ended before its expiry date | You |

Statuses are recalculated every time you unlock the app, and on demand with
**Recalculate** on the [renewals desk](renewals.md). Cancelled is the only one
nothing ever changes for you: a cancelled year stays cancelled however long it
sits there, and stays cancelled even after you renew it, so the book can always
tell you the cover was ended early that year.

## Keyboard

| Keys | Action |
| --- | --- |
| **⌘K** / **Ctrl+K** | Jump to search |
| **Esc** | Close the open dialog |

## Client codes

Left to itself, the app allocates `CL-00001`, `CL-00002` and so on. Type your
own code on the [client form](clients.md#every-field-on-the-client-form) to keep
the numbering you already use — the app carries on from the highest `CL-` number
it can see.

Client codes are searchable, and an [import](import-your-book.md) matches on
them first, so a file that carries your codes never creates a duplicate.

Everybody in a [family](families.md) is a client, so a spouse or child gets a code
of their own. The next code the app offers therefore counts them too.

## Exports

**Export** appears on the clients, policies and renewals screens. Each one saves
exactly what the current filters show, as Excel or CSV.

Filter first, export second. "Health policies expiring in March with one
insurer" is three filters and a button.

## Still to come

Claims tracking, premium and commission records, the printable report pack, and
separate logins for your staff. Each is planned, and none of them is switched on
today. The
[release notes](https://laksagent-png.github.io/StayInsured/release-notes.html)
record each one as it arrives.

## Questions

**Can two people share one book?** Not at the same time. Each installation keeps
its own data, and [copying the data folder](backups-and-data.md#move-to-another-computer)
moves a book to a new machine.

**Is any of this on the internet?** No. Nothing leaves your computer unless you
point backups at a cloud folder yourself.

**What if I forget the password?** A trusted device can still open the book, and
you should [change the password](settings.md#change-your-password) to something
you will keep. Without one, the data cannot be recovered by anyone. That is the
other side of real encryption.

**Will updating lose my data?** No. A newer version replaces the app, not your
book.

**Will it run on Windows 7?** No, and the installer says so instead of leaving
you with an app that will not open. Windows 10 version 1803 is the oldest it
runs on, because the component every screen is drawn with stopped supporting
Windows 7, 8 and 8.1 in January 2024.

**Why is a policy I renewed still showing?** Check the **Overdue** tab: a policy
is only marked renewed when the next year is recorded against it. Recording next
year through **Renew** rather than as a new policy is what links the two.

**Something looks wrong.** Open an issue at
https://github.com/laksagent-png/StayInsured/issues saying what you did and what
happened. If a spreadsheet import upset it, name the column — but do not attach
a file with real client details in it.

---

[← Guide contents](index.md)
