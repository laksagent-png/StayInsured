# Sample book

A dataset for exercising every screen by hand. Written by
`scripts/sample-data.mjs` with expiry dates measured from **2026-08-15**, so the
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

Import them in number order, and run **Check without saving** before each one.
Leave `04-corrections.csv` until last: it rewrites the policies it touches, and
seeing that is the point of it.

## 1. The clean book

34 clients and 51 policies, with headers named exactly as the
import screen names its fields, so every column maps on the first pass and
**Unmapped** stays empty.

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
| Add a member to a client, then attach them to one of their policies | The member picker on the policy form |
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
