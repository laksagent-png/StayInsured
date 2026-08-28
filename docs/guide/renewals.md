[← Guide contents](index.md)

# Work the renewals

The renewals desk at `/renewals` is where the day's work is. It puts every
policy in front of you in the order cover stops, and turns a renewal into one
dialog.

- [The desk](#the-desk)
- [Recalculate](#recalculate)
- [Copy emails](#copy-emails)
- [Export the list](#export-the-list)
- [Record a renewal](#record-a-renewal)
- [Read the history](#read-the-history)
- [A renewal routine that works](#a-renewal-routine-that-works)

## The desk

![Renewals](screenshots/renewals.png)

Policies are grouped by how soon cover stops. Each tab carries its own count, so
the shape of the week is visible before you click anything.

| Tab | Holds |
| --- | --- |
| **Overdue** | Cover that has already stopped with nothing replacing it |
| **Next 7 days** | Active policies expiring within a week |
| **Next 30 days** | Active policies expiring within a month — where the screen opens |
| **Next 60 days** | Active policies expiring within two months |
| **Next 90 days** | Active policies expiring within three months |

A [cancelled](policies.md#what-the-statuses-mean) policy is on none of these
tabs, whatever its expiry date. It can still be renewed, from its row on the
**Policies** screen.

Each list is ordered by urgency, so work down from the top. The **Client**,
**Policy**, **Type**, **Expiry** and **Premium** headings re-order it when you
would rather work by client or by what the renewal is worth; a second press
turns the order around. Long lists page twenty-five at a time.

The badge on the sidebar counts the 30-day tab, which is the number to clear.

A window with nothing in it says **Nothing expires in this window**, and a clear
**Overdue** tab says **Nothing has lapsed** — neither is left as a blank table.
A desk the book could not read says so and offers **Try again**, so an empty
morning is never a hidden failure.

## Recalculate

**Recalculate** rechecks every policy against today's date and moves statuses
on: active to expired, expired to lapsed, and back to active if you have
corrected an expiry date.

It then tells you what it did — *Statuses recalculated against today's date,
moving 3 policies on*, or *and nothing moved on* when the desk was already
current. A quiet desk and a stale desk look the same until something says which
one you are looking at.

This happens on its own every time you unlock the app. Press it when you have
left the app open overnight and want the counts to mean today.

## Copy emails

**Copy emails** puts the email addresses from the tab you are looking at on the
clipboard, ready to paste into the To field of your mail program. A toast tells
you how many were copied.

| Rule | Effect |
| --- | --- |
| Clients with no email address | Left out — fix them from [Missing email](clients.md#find-a-client) |
| Clients with **Do not send reminders** ticked | Left out, always |
| The same client on two expiring policies | Copied once |
| Very long lists | Up to 500 addresses in one go |
| A tab with nobody left to email | Says so, and copies nothing |

This is the manual route, for a batch you want to write yourself. To have the
app write to them on a schedule instead, see [Send the
reminders](reminders.md).

## Export the list

**Export** saves the tab you are looking at as Excel or CSV, with client name,
contact details, insurer, premium and expiry date. Useful for a call sheet, or
for handing the week's chase list to someone else.

## Record a renewal

Press **Renew** on the row.

The button sits on every row here and on every row of the
[Policies](policies.md) screen, including a cancelled year: a client who
cancelled and then came back is renewed from there, since the desk never lists
them. It goes only once a year has been renewed, because the next year is
already on record — and a year cannot be renewed twice, so if you are looking
for **Renew** on an old year, it is on the latest year of that policy.

![Renew a policy](screenshots/renew-policy.png)

Last year's details are already in the form and the dates run on from the
expiring year. Change what the insurer changed.

Across the top sit the two years side by side: the expiring one with its number,
insurer, dates and premium, and next to it the year you are about to write. The
right-hand side follows what you type, so the new number and the new dates are
visible before anything is recorded.

| Field | Pre-filled with | Notes |
| --- | --- | --- |
| **New policy number** | Last year's number | Insurers often issue a fresh one |
| **Sum insured** | Last year's cover | |
| **Start date** | The day after the expiring policy ends | |
| **Expiry date** | One year less a day after the new start date | |
| **Premium** | Last year's premium | Tells you how far you have moved from last year as you type |
| **GST** | Last year's GST | |
| **Commission %** | Last year's rate | |
| **Commission amount** | Empty | What the rate comes to on the new premium, unless you type your own |
| **Notes for this renewal** | Empty | What changed, and why |

A policy that has run more than a year lists its earlier years under **History**
at the foot of the dialog, so last year's premium is in front of you while you
type this year's.

Everything the dialog does not ask about comes forward on its own: the frequency,
the payment mode, the nominee, the answers a
[health proposal](policies.md#a-health-policy) asked, and the vehicle a
[motor policy](policies.md#a-motor-policy) is written on. A motor policy's cover
dates and split premiums are the exception — they described last year, so the new
year comes back with them empty and you fill them in from this year's schedule.

Press **Record renewal**, or press Enter from any box. The dialog closes, the row
leaves the tab, and the new year takes its place on the list. An expiry date that falls before the start
date is refused in the dialog rather than written. **Cancel**, the corner cross
and the Escape key all close it without recording anything, and it opens next
time on the policy's own figures rather than on what you abandoned.

**Renewing never overwrites last year.** It writes the new policy year, marks
the expiring one **Renewed** — unless that year was cancelled, which stands —
and links the two, so what the client paid each year stays on record. That is the difference between a book you can quote from
and a spreadsheet that only knows today.

## Read the history

On the **Policies** screen, press the history button on any policy past its
first year.

![Policy history](screenshots/policy-history.png)

Each row is one year of the same underlying cover: the number it carried that
year, the dates it ran between, the premium and the sum insured. Read down the
premium column and you have the client's renewal story in one look — which is
the argument you need when this year's premium goes up.

## A renewal routine that works

1. Open **Renewals** in the morning and press **Recalculate**.
2. Clear **Overdue** first. Cover has already stopped for these people.
3. Work **Next 7 days**, then **Next 30 days**.
4. **Copy emails** on the tab and send the batch, then call the ones who matter.
5. As each renewal is confirmed, press **Renew** and record it while it is in
   front of you.

---

Next: [keep insurers and plans tidy](insurers-and-plans.md).
