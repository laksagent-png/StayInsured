[← Guide contents](README.md)

# Manage policies

Every policy year you have placed sits on the **Policies** screen at
`/policies`. Renewing is on its [own page](renewals.md); this one covers
recording, finding and correcting policies.

- [Record a policy](#record-a-policy)
- [Every field on the policy form](#every-field-on-the-policy-form)
- [Find a policy](#find-a-policy)
- [What the statuses mean](#what-the-statuses-mean)
- [Edit a policy](#edit-a-policy)
- [Delete a policy](#delete-a-policy)
- [Export the list](#export-the-list)

## Record a policy

Press **New policy**, or **Add policy** on a client's page to skip choosing the
client.

![New policy](screenshots/policy-new.png)

Client, policy number, insurer, category, start date and expiry date are
required. Everything else earns its place: fill in premium and commission and
the app can tell you what the book is worth.

Press **Save**. The policy appears immediately in the list, on the client's
page, and — once it comes within range — on the [renewals desk](renewals.md).

One client holds as many policies as they need. Each carries its own number,
insurer, premium and expiry date, and each falls due in its own time.

## Every field on the policy form

| Field | Required | Notes |
| --- | --- | --- |
| **Client** | Yes | Type to search the book. Pre-filled when you start from a client's page |
| **Policy number** | Yes | Searchable from anywhere in the app |
| **Insurer** | Yes | From your [insurers list](insurers-and-plans.md) |
| **Plan** | | The insurer's product. Pick the insurer first |
| **Category** | Yes | Health, life, motor and the rest — see [categories](reference.md#categories) |
| **Start date** | Yes | |
| **Expiry date** | Yes | Fills itself in one year less a day after the start date. Overwrite it when the insurer says otherwise |
| **Sum insured** | | |
| **Premium** | | The gross premium |
| **GST** | | |
| **Frequency** | | Annual, half-yearly, quarterly, monthly or single |
| **Commission %** | | |
| **Commission amount** | | Worked out from the premium and rate unless you type your own |
| **Payment mode** | | |
| **Nominee** | | |
| **Nominee relation** | | |
| **Vehicle number** | | Appears for motor policies only |
| **Members covered** | | The [members](insured-members.md) on this client, as chips to tick |
| **Notes** | | |

Two fields fill themselves in and then get out of the way: **Expiry date**
follows the start date, and **Commission amount** follows the premium and rate.
Type over either one and your value stands.

## Find a policy

![Policies](screenshots/policies.png)

| Control | What it does |
| --- | --- |
| Search box | Matches policy number, client name or vehicle number |
| **All categories** | One kind of cover |
| **Any status** | Active, expired, lapsed, renewed or cancelled |
| **All insurers** | One company |
| **Expiry between** | Any window of dates you like |
| **Latest year only** | Hides superseded years, leaving the current picture |
| **Expired and never renewed** | The chase list: cover has stopped and nothing replaced it |
| **Clear filters** | Resets the screen |

The two switches answer the questions you ask most. **Latest year only** is how
you count the book without counting the same cover four times. **Expired and
never renewed** is who to call.

The search box at the top of the app searches the same three things from
wherever you are — press **⌘K** or **Ctrl+K**.

## What the statuses mean

Statuses are worked out from the calendar, not typed in. They are brought up to
date every time you unlock the app, and on demand with **Recalculate** on the
[renewals desk](renewals.md).

| Status | Set when |
| --- | --- |
| **Active** | The expiry date is today or later |
| **Expired** | The expiry date has passed within the last 30 days and nothing has replaced it |
| **Lapsed** | The expiry date passed more than 30 days ago and nothing has replaced it |
| **Renewed** | A later policy year exists in the chain |
| **Cancelled** | You ended it early. This one is set by hand and the app leaves it alone |

Correcting an expiry date to a future date makes the policy active again, so a
typo costs you nothing.

## Edit a policy

Click any row to open that policy year and change it. **Save** commits.

**Editing changes that year alone.** When the insurer issues next year's policy,
[record a renewal](renewals.md#record-a-renewal) instead — that writes the new
year and keeps this one on record. Editing this year's premium to next year's
number destroys the history you are keeping.

## Delete a policy

The delete button removes a single policy year after asking. Use it for a record
entered twice or entered wrongly.

Deleting a year out of the middle of a chain leaves the years either side
intact.

## Export the list

**Export** saves whatever the filters currently show as Excel or CSV — the
motor book, this quarter's expiries, everything with one insurer.

---

Next: [work the renewals](renewals.md).
