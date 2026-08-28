[← Guide contents](index.md)

# Manage clients

Everyone in your book lives on the **Clients** screen at `/clients`. This page
covers adding them, finding them again, and what happens when someone leaves.

- [Add a client](#add-a-client)
- [Every field on the client form](#every-field-on-the-client-form)
- [Find a client](#find-a-client)
- [Open one client in full](#open-one-client-in-full)
- [Edit a client](#edit-a-client)
- [Archive a client](#archive-a-client)
- [Delete a client](#delete-a-client)
- [Export the list](#export-the-list)

## Add a client

Press **New client**. Only the full name is required — record what you know now
and fill the rest in as you learn it.

![New client](screenshots/client-new.png)

Press **Add client** and they are in the book, ready for their first policy.
Enter from any of the text boxes does the same, so a whole client can be typed
without reaching for the mouse. **Cancel**, the cross in the corner and the
Escape key all close the form without saving.

Leave **Client code** empty and the app allocates the next one for you in the
form `CL-00001`. Type your own if you already number clients and want to keep
those numbers.

**Record the email address if you have it.** It is what every renewal mailing
list is built from, and a client without one carries a warning everywhere they
appear.

## Every field on the client form

| Field | Required | Notes |
| --- | --- | --- |
| **Client type** | | **Individual** or **Company**. See [companies and groups](groups.md) |
| **Full name** | Yes | The only required field. Reads **Company name** for a firm |
| **Client code** | | Allocated as `CL-00001` if you leave it blank |
| **Mobile** | | Digits are cleaned up as they are stored |
| **Email** | | Reminders cannot be sent without this. An address that is not one is refused |
| **Alternate phone** | | A landline or a second number |
| **Contact person** | | Companies only. Who you ask for when you ring |
| **Designation** | | Companies only. Their job title |
| **Date of birth** | | People only. Used to know when age-banded premiums move |
| **Gender** | | People only. Male, female or other |
| **Address** | | Street address |
| **Area / locality** | | |
| **City** | | Also a filter on the client list |
| **State** | | |
| **Pincode** | | |
| **Occupation** | | Reads **Industry** for a firm |
| **PAN** | | Searchable, so a PAN in hand finds the client |
| **GSTIN** | | Companies only |
| **Registration number** | | Companies only. CIN, LLPIN or as registered |
| **Do not send reminders** | | Keeps this client out of every mailing list the app produces |
| **Notes** | | Anything you want to remember before you call them |

**Client type** decides which of those fields the form draws. Switching it to
**Company** puts the contact person, the GSTIN and the registration number in
place of the date of birth and the gender, because a firm has no birthday and a
person has no CIN. Everything else is the same either way.

Tick **Do not send reminders** for a client who has asked not to be emailed. They
stay in your book and keep their policies, but **Copy emails** on the
[renewals desk](renewals.md) will never include them.

Two things stop a save: a client with no name, and an email address that is not
an address — `rohit@example` and `rohit at example.com` are both turned back.
The dialog says which it is, keeps everything you typed, and waits for you to
put it right.

## Find a client

![Clients](screenshots/clients.png)

| Control | What it does |
| --- | --- |
| Search box | Matches name, phone, email, client code or PAN |
| **All cities** | Narrows to one city. A screen reader calls it City |
| **Any policy type** | Narrows to clients holding that kind of cover. A screen reader calls it Policy type |
| **People and companies** | Narrows to **People only** or **Companies only**. A screen reader calls it Client type |
| **Missing email** | Only clients who cannot be emailed |
| **Include archived** | Brings archived clients back into view |
| **Include family members** | Brings in the people covered on somebody else's policy, with none of their own |
| Column headings | Sort by client, by group, by number of policies, or by next expiry |

Filters combine, so "Mumbai, health, missing email" is one click each. The list
pages at the foot when there is more than a screenful.

Everybody in a [family](families.md) is a client, so browsing shows the people who
hold the cover and marks anybody else **Family member** when you ask for them.
Searching reaches the whole book either way: a child's name finds the child
whether the box is ticked or not.

Each row shows the client's contact details, the [group](groups.md) they are
filed in, how many of their policies are
active out of the total, and when the next one expires — enough to decide who to
call without opening anyone. A client with no email address is marked **No
email** in amber on their row, and a company carries a building mark instead of
initials.

Three answers are told apart rather than run together. A search that matches
nobody says **No clients match** and suggests clearing the filters. A book with
nothing in it yet says **Nothing in the book yet** and offers **Add a client**.
A book that could not be read says so and offers **Try again** — an empty table
is never used to mean a failure.

## Open one client in full

Click a client's name.

![Client page](screenshots/client-detail.png)

Everything about them is on one page: contact details, their
[family](families.md), the [group](groups.md) they are filed in and any groups
they referred, every policy they hold with its status and expiry date,
and the [documents](documents.md) you have attached.

A company's page reads a little differently, since a firm has no family: the
contact person, their designation, the GSTIN and the registration number sit in
place of the date of birth and the gender, and the family card gives way to the
group.

From here you can **Edit** the client, **Add policy** without choosing the client
again, link or unlink a relative, and renew or edit any policy on the list. A
client with no email address carries an amber line across the top of their page
saying they cannot receive renewal reminders.

An address that names nobody — a deleted client, or a mistyped one — says
**Client not found** rather than an empty page. A client the book could not read
says so, and offers **Try again**.

## Edit a client

Press **Edit** on the client's row or on their page. The form is the one you
filled in when adding them, and **Save changes** commits it. Editing a client
never touches their policies.

## Archive a client

**Archive** on the client's row takes them out of the working list without
deleting anything. Their policies, history and family stay exactly as they are.
The same thing sits on their own page as **Archive client**, with **Archive
family** beside it when anybody is linked to them — a household usually leaves
together.

Archive is the right answer when someone stops buying from you: the record stays
for reference, and the client stops cluttering your day.

Archived clients carry an **Archived** badge and reappear with **Include
archived**. The button that put them there then reads **Restore** on the row and
**Restore client** on their page.

## Delete a client

**Delete permanently** on the client's page removes the client and every policy
record belonging to them. It asks first, counting the policy records that go with
them and listing the [family](families.md) on file, and nothing brings them back.

The dialog offers two answers where there is a family. Deleting this client only
leaves their relatives standing as clients with their own policies — just the
links to them go. Deleting the client and their relatives reaches the people
linked to this one and stops there.

Use it for a duplicate or a record created in error. For a real client who has
left, archive instead.

## Export the list

**Export** saves whatever the filters currently show as Excel or CSV. Filter
first, export second — "health clients in Pune with no email" is a filtered list
and then one button.

---

Next: [record their family](families.md) or [add their policies](policies.md).
