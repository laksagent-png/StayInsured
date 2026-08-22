# Sample book

A dataset for exercising every screen by hand. Written by
`scripts/sample-data.mjs` with expiry dates measured from **2026-08-22**, so the
renewals tabs, the dashboard buckets and the reminder ladder all have policies
sitting exactly on their boundaries. Regenerate whenever the dates go stale:

```bash
npm run sample:data
```

Every name, number, address and PAN here is invented.

## The files

| File | Import it to see |
| --- | --- |
| `01-clean-book.csv` | The main book — every category, every renewal window, every status the calendar can produce |
| `02-messy-headers.csv` | Column names and value formats the app has to guess at |
| `03-broken-rows.csv` | Rows that must be reported rather than saved |
| `04-corrections.csv` | A re-import that matches existing clients four different ways and fills their gaps |
| `05-missing-expiry-column.csv` | A file with no expiry column, which the import screen has to refuse |
| `06-clean-book.tsv` | Eight rows of the clean book, tab separated |
| `07-volume.csv` | 240 more clients, for pagination, sorting and a book that is not almost empty |
| `08-workbook.xlsx` | A two-sheet Excel file with real dates and real numbers, so the sheet picker has something to pick |
| `09-families.csv` | Three generations, a relative who belongs to two households, and two families joined by a name common enough to catch the importer out |

Import them in number order, and run **Check without saving** before each one.
Leave `04-corrections.csv` until last: it rewrites the policies it touches, and
seeing that is the point of it.

## 1. The clean book

34 policyholders and 51 policies, with headers named exactly as
the import screen names its fields, so every column maps on the first pass and
**Unmapped** stays empty.

The **Covered members** column names 13 more people, and everybody on a
floater is a client, so the book ends up holding 47. They are family
members with no cover of their own, so the clients list shows 34 until you
tick **Include family members** — and the dashboard tiles below count
policyholders throughout. File 9 is the one that exercises this properly.

After importing with **Update records that already exist** on, the dashboard
should read:

| Tile | Value |
| --- | --- |
| Expiring this week (0–7 days) | 8 |
| Within 30 days | 21 |
| Unrenewed and expired | 7 |
| Premium under management | ₹12,53,850 |
| Commission expected | ₹1,20,480 |
| Clients with no email address | 6 |

Renewal pipeline: Overdue 7 · 0-7 days 8 · 8-15 days 6 ·
16-30 days 7 · 31-60 days 7 · 61-90 days 6.

Renewals desk, tab by tab:

| Tab | Policies |
| --- | --- |
| Overdue | 7 |
| Next 7 days | 8 |
| Next 30 days | 21 |
| Next 60 days | 28 |
| Next 90 days | 34 |

**Next 45 days** on the dashboard holds 26 policies but shows twelve, so the
truncation is visible.

Mix by category, counting the 44 active policies the way the
dashboard does:

| Category | Policies |
| --- | --- |
| Health | 17 |
| Motor | 8 |
| Travel | 5 |
| Life | 4 |
| Personal Accident | 4 |
| Home | 4 |
| Critical Illness | 1 |
| Other | 1 |

Of the 7 that have already expired, 4 are inside the thirty-day
grace and read *expired*; 3 are past it and read *lapsed*.

The import report will say **17 clients updated** even though nothing about them
changed. That is one per client who appears on more than one row: the second row
re-runs the gap-filling update, and the update counts as a change whether or not
it altered anything.

### Boundaries the data sits on

- **Expires today** — `AB/HL/330778` (Sandeep Kulkarni). Still active, still in the 0–7 bucket.
- **Expires tomorrow** — `DG/MOT/220118`. The 1-day reminder rule fires on it.
- **Exactly 30 days past expiry** — `SH/2025/0088410`. Reads *expired*: the grace is `> 30`, not `>=`.
- **Exactly 31 days past** — `NIA/MOT/330912`. Reads *lapsed*.
- **Seven days past** — `BA/PA/117203`. The day the seeded post-expiry rule would fire, if you activate it.
- **Reminder ladder** — one policy on each rule day: 60d (1), 30d (1), 15d (1), 7d (1), 1d (1).
- **Shared policy number** — `DUP/2026/5001` exists under two insurers. Both are valid; the same number twice under one insurer is not.
- **Premium range** — ₹850 (Ajay Kumar's travel cover) to ₹4,80,000 (Manish Agarwal's endowment).
- **Members** — separated with `;`, `,`, `/` and `|` on different rows, all of which the importer accepts.

## 2. Headers nobody standardised

Ten rows written the way an agency actually keeps its register: `Customer Name`,
`Policy No.`, `Valid Till`, `Sum Assured`, `LOB`, `Reg No`, `Lives Covered`. The
mapping screen should fill itself in and leave `Sr No` unmapped.

Check as you go:

- `₹10,00,000`, `Rs. 24,500.50` and `4,410` all read as numbers.
- `(1,200)` reads as **-1200** — accounting brackets mean negative.
- Dates arrive day-first, dashed, dotted, `5-Sep-2026`, `5 September 1971`, `Mar 03, 1977`, year-first with slashes, ISO, and as a bare Excel serial. All land on the same shape.
- `Star Health`, `New India`, `HDFC Ergo`, `STAR` and `Oriental` all match seeded insurers on a partial name or a short code. **Kotak Mahindra General Insurance** is not seeded, so the report should say one insurer was created.
- `Mediclaim`, `Two Wheeler`, `Term Plan`, `Overseas Travel`, `Householder's Package`, `PA Cover` and `Cancer Care` map onto the eight categories. `Commercial Vehicle` has no bucket, so it lands on **Other**.
- Row 8 leaves the category blank and the plan reads *Star Comprehensive*, so the category is taken from the plan name.
- Row 3's email reads `raghavan[at]example.com`; the row imports and the address is dropped.
- Row 3 has no start date, so it is back-dated 364 days from expiry.

## 3. Rows that should be refused

Run **Check without saving** first. Five rows fail and are named in *Rows needing
attention*; the rest import with something quietly dropped. The blank row never
reaches the importer — a row of empty cells is discarded while the file is read.

Then run it again with **Update records that already exist** switched **off**:
the row carrying `SH/2026/0091823` moves from *updated* to *skipped*.

## 4. A corrected file

Proves the four ways a row finds an existing client — code, then email, then
phone, then name — and that filling gaps never overwrites. Row 1 claims Rohit
Sharma lives in Mumbai; after the import he must still be in Pune. Row 4 carries
`CL-00003` with a stranger's name and email, and lands on Vikram Patel, because
the code is checked first.

Vikram Patel and Ajay Kumar both gain an email, so the no-email count drops from
6 to 4.

**Run this one last, or back up first.** Clients are gap-filled, but policies are
not: a matched policy is rewritten from the file, and every column the file does
not carry is emptied. This file has no sum insured, GST, nominee or member
columns, so the five policies it touches lose them. That asymmetry is worth
seeing once — a narrow correction file quietly strips the columns it left out.

## 5. A file missing a required column

There is no expiry column at all. The mapping panel shows **Needs Expiry date**
and refuses to run.

## 6. Tab separated

The same eight rows as the clean book in `.tsv` form, for the delimiter path.
Everything is already in the book, so expect 8 updates and no new clients.

## 7. Volume

240 clients and 240 policies, codes `CL-01000` upward. Import this when you want
to see pagination, sorting across pages, a long city list, and how the lists
behave when they are not almost empty. Expiries are spread across 420 days, so
every bucket fills out.

## 8. A real workbook

Seven rows in a two-sheet `.xlsx`. The first sheet is *Read me*, so the import
screen must offer the sheet picker and you have to choose **Policies** yourself.
Dates and amounts are stored as Excel dates and numbers rather than text, except
the last row where everything is a string — both should import identically.

## 9. Families

5 policyholders and 7 policies whose cover lists build one deliberate
family shape. Import it and the book gains 9 people joined by
7 relationships, every one of them named by the file, of whom 4 have no cover
of their own.

The rows are ordered on purpose. **Rajesh Rangan** is a name on his father's
policy in row 1, which makes him a client there and then; row 2 gives him a
floater of his own and finds him rather than opening a second copy of him. That
is the whole reason a family member is a client — nothing had to be migrated at
the counter on the day he bought cover.

What the shape is for:

| Open | And see |
| --- | --- |
| Aarav Rangan | A family of 6 read from the bottom of it: his grandfather is two steps away, and the old member table could not answer that at all |
| Rajesh Rangan | 3 relatives on his page — **Son of** Mohan, **Spouse** Priya, **Son** Aarav — three policies, and a family of 6 once the walk goes past them |
| Priya Rangan | Two edges from one person, **Spouse of** Rajesh, **Daughter of** Lakshmi, from two different rows — which is why a family is edges and not a household id |
| Lakshmi Menon | Her daughter, covered on her policy as well as on her husband's. A life may be named on any policy in the family |
| Anil Kumar | Two families, wrongly. Read on |

### The sharp edge, on purpose

Rows 6 and 7 both cover somebody called **Anil Kumar**, in two families that have
nothing to do with each other. One person of that name was already in the book by
the time the second row arrived, so the importer linked to him instead of opening
a second file on him, and the two households are now one family.

That is the documented rule doing exactly what it says, and it is worth seeing
once: a cover list is a column of names, and names are not identifiers. Open Anil
Kumar, and **Unlink** the relationship that does not belong. Nothing else in the
sample data gives you a reason to unlink anything.

A name is resolved in four steps, and the order is what matters here: the holder
themselves, then somebody already related to the holder, then one unambiguous
client of that name, and only then a new person.

The second step is why importing this file twice adds nobody — each Pai is already
related to an Anil Kumar, so that match is found before the book at large is
searched. It holds even if you add another client of the same name in between.

The last step is what refuses to guess. Add **two** clients called *Anil Kumar* by
hand to an empty book, then import this file: two people already answer to that
name, so neither row chooses between them and each enters a new person instead.
Four of them, and the report says two clients were created.

### Where the relationships come from

All 7 relationships are named by the file, because this one writes the word where
an agency register writes it. Every shape it might use is in here, and each is read
the same way:

| The file says | The book records |
| --- | --- |
| `Rajesh Rangan (Son)` | Mohan's son |
| `Daughter - Priya Rangan` | Lakshmi's daughter |
| `Vasanthi Rangan`, with **Nominee relation** *Spouse* | Mohan's spouse, taken from the nominee columns because the cover list said nothing |
| `Self` | The holder, not a second client of his own name |

Only a word the app knows is taken as a relationship, so a name with a bracket or a
hyphen in it survives intact. Anything unrecognised stays part of the name, and a
pair the file says nothing about reads **other** until somebody sets it.

### What a cover list cannot say

A cover list ties each life to the policyholder and to nobody else. Priya and Aarav
are both on Rajesh's floater, so she is his spouse and the boy is his son — and the
tie between the two of them is not on his page, on hers, or anywhere in the file.
Nothing guesses it. Adding it is the demonstration:

1. Open Priya Rangan, **Link a relative**, and record Aarav as **Son**. His page now
   reads *Son of* for the same relationship — one edge, read from either end, with a
   preposition rather than a guess at gender.
2. From Aarav's page, set that same relationship to **Mother**. There is still one
   relationship, now recorded the other way round; it is corrected, not contradicted.
3. From Aarav's page, try to record Mohan — his grandfather — as *his* son. It is
   refused: nobody can be their own ancestor. Only parent and child edges can
   contradict themselves this way, which is why step 4 stands.
4. Priya now holds three relationships from three sources: a husband her floater
   gave her, a mother her own policy did, and a son you added. She belongs to two
   households at once, which is the case a household id cannot hold.

Import the file again afterwards. It restates the 7 relationships it named and
leaves the one you added alone — a file silent about a pair does not flatten it, and
a file that names one corrects it.

### Archive and delete stop one step out

Rajesh's page offers **Archive family** and, on delete, a choice. His immediate
family is Mohan, Priya, Aarav, so:

- **Archive family** moves 4 people. Vasanthi and Lakshmi stay where they are, though the
  walk reaches both of them.
- **Delete this client and 3 relatives** takes the same 4. An in-law's own parents are
  their own household, and a delete confirmed against a list of three should not
  quietly take five.
- **Delete this client only, and keep the family** leaves all 8 of the others
  standing. It takes his relationships, not the people in them.

### Browsing, searching and counting

| Check | Expect |
| --- | --- |
| Clients list, as it opens | The 5 policyholders |
| Tick **Include family members** | All 9, the family ones badged as such |
| Search *Vasanthi* with the box unticked | She is found. A book that held her and would not admit it would be worse than one that never held her |
| Dashboard, total clients | 5. Counting people would report 9, and every child as a client with no email address |
| Add a policy for Aarav by hand | He is in the list with the box clear, and no longer badged. Buying cover is all it took |

### Cover lists on the policy form

Open any of these policies and the lives are the holder and the people related to
them, and nobody else. Rajesh's motor policy covers only him, though his family
panel is full — a cover list is per policy. Try the form on Ganesh Pai before you
unlink, and Sunil Pai is offered, which is the same wrong join seen from the other
side.

## Reminders

The clean book puts exactly one policy on each active rule day, so the ladder
has something to find the moment it is switched on:

| Rule | Policy | Client |
| --- | --- | --- |
| 60 days before expiry | `NB/RA2/119006` | Meera Iyer |
| 30 days before expiry | `CH/2026/771203` | Priya Menon |
| 15 days before expiry | `HE/PAS/700904` | Kavita Joshi |
| 7 days before expiry | `TA/TG/908771` | Suresh Nair |
| 1 day before expiry | `DG/MOT/220118` | Arjun Reddy |
| 7 days after expiry (seeded off) | `BA/PA/117203` | Harpreet Singh |

All five have an email address on file, so a plan should show five due today. Tick
**Do not send reminders** on Kavita Joshi and it becomes four to send and one
recorded as skipped — recorded once, not retried on every sweep.

Turn the post-expiry rule on and Harpreet Singh's accident cover joins them.
Renew Arjun Reddy's motor policy and the reminder queued against it is
cancelled rather than sent.

With the expiring-soon window left at 30, the daily digest covers 21
policies.

## Worth trying alongside the files

**Download template** on the import screen, fill in a row, and import it back.
The template writes its own field labels as the headers, and `Commission %`
normalises to `commission`, which is the exact synonym for the commission
*amount*. So the percentage lands in the amount column, `Commission amount` is
left unmapped, and the commission rate never arrives at all. Any file whose
header reads *Commission %* has the same problem; `Commission rate` maps
correctly, which is what the clean book uses.

## What import cannot reach

These are the states no spreadsheet can create. Set them by hand once the book
is loaded.

| Do this | To test |
| --- | --- |
| Open Kavita Joshi and tick **Do not send reminders** | The opt-out badge, and her exclusion from **Copy emails** |
| Archive Om Prakash Yadav | The archived badge, **Include archived**, and his absence from the default list |
| Delete a volume client | The cascade — their policies go too |
| Renew `SH/2026/0091823`, then renew the result | A three-year chain, the history dialog, and the previous years reading *renewed* |
| Renew something in the overdue tab | The tab emptying by one, and the reminder queued against it being cancelled |
| Try to delete Star Health in **Insurers & plans** | The refusal — an insurer holding policies can only be deactivated |
| Deactivate Acko, then tick **Show inactive** | Both halves of the insurer list |
| Link a relative to a client, then tick them on one of their policies | The cover list on the policy form, which offers the holder and their family and nobody else |
| Set the relationships on the family in file 9, then archive and delete it | The words read from either end, the ancestry refusal, and both delete scopes |
| Settings → fill in the SMTP block, save a password, then **Send test** | The mail path, without touching a client |
| Settings → turn **Dry run** off, then run the reminders | Sending for real, against the rehearsal |
| Reminders → turn a rule off and plan again | The ladder shortening by one |
| Reminders → **Everything that has gone out** | The log, and retrying or cancelling a row |
| Settings → set an expiring-soon window of 7, then plan again | The digest window |
| **Back up now**, then check the backup folder | Backups and retention |
| Export from all three screens with filters applied | That the export follows the filters, in both `.xlsx` and `.csv` |

Cancelling a policy has no control on any screen. `set_policy_status` exists in
the API and the status is in the schema, but nothing in the interface calls it,
so `cancelled` cannot be reached by hand today.
