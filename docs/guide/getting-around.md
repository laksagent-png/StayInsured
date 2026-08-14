[← Guide contents](index.md)

# Find your way around

The eight screens, the search box, and how to read the dashboard.

- [The sidebar](#the-sidebar)
- [Search and the badges](#search-and-the-badges)
- [Read the dashboard](#read-the-dashboard)
- [An empty book](#an-empty-book)

## The sidebar

![Dashboard](screenshots/dashboard.png)

| Screen | Address | What it is for |
| --- | --- | --- |
| **Dashboard** | `/` | The state of the book in one view |
| **Renewals** | `/renewals` | The working list, ordered by urgency |
| **Reminders** | `/reminders` | What the app writes to clients, and when |
| **Clients** | `/clients` | Everyone in the book |
| **Policies** | `/policies` | Every policy year you have placed |
| **Insurers & plans** | `/insurers` | The companies and products you sell |
| **Import data** | `/import` | Bring a spreadsheet in |
| **Settings** | `/settings` | Agency details, password, backups, your mail server |

The number beside **Renewals** counts the policies expiring within 30 days. It
updates as you work, so an empty badge means the week is clear.

The number beside **Reminders** counts what is due to go out today plus anything
that failed to send. It turns red when something has failed, because those are
the clients who did not hear from you.

Your agency name sits at the top of the sidebar and **Lock app** at the foot.

## Search and the badges

The search box at the top finds policies by **policy number**, **client name**
or **vehicle number**. Press **⌘K** on a Mac or **Ctrl+K** on Windows to jump
into it from anywhere, and **Esc** to leave it. Results appear as you type;
picking one opens that policy.

Two badges sit beside the search box:

- **Active cover** — how many policies are running right now.
- **Due this week** — how many expire within seven days. When this is not zero,
  it is your day's work.

## Read the dashboard

Every number on the dashboard is a link to the list behind it, so nothing has
to be counted by hand.

| Panel | What it tells you | Where it goes |
| --- | --- | --- |
| **Active policies** | Live cover across the book | The policies list |
| **Expiring this week** | Cover stopping within seven days | The renewals desk |
| **Unrenewed & expired** | Cover that stopped with nothing replacing it | The chase list on the policies screen |
| **Premium under management** | Premium on all active policies | — |
| Amber banner | Clients with no email address | Those clients, filtered |
| **Renewal pipeline** | How the next 90 days are loaded, overdue in red | The matching renewals tab |
| **Mix by category** | Live cover split across health, life, motor and the rest | — |
| **Next 45 days** | The nearest expiries, soonest first | The client behind each row |
| **Recently lapsed** | Cover that has stopped and needs chasing | The client behind each row |

Work the dashboard top to bottom in the morning: clear **Expiring this week**,
then look at **Recently lapsed** for anyone who slipped.

The **Expiring soon window** in [Settings](settings.md) decides how many days
ahead count as expiring soon here.

## An empty book

![Empty dashboard](screenshots/dashboard-empty.png)

Before there is anything to show, the dashboard offers the two ways to fill it:
[import a spreadsheet](import-your-book.md) or
[add a client by hand](clients.md).

---

Next: [work the renewals](renewals.md).
