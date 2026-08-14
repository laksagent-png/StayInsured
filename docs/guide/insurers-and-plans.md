[← Guide contents](index.md)

# Insurers and plans

The **Insurers & plans** screen at `/insurers` holds the companies you place
business with and the products they sell. Keeping it clean is what stops "HDFC
Ergo" being recorded three different ways and your motor book being split across
all three.

- [The screen](#the-screen)
- [Add an insurer](#add-an-insurer)
- [Add a plan](#add-a-plan)
- [Retire an insurer or plan](#retire-an-insurer-or-plan)
- [Delete an insurer or plan](#delete-an-insurer-or-plan)

## The screen

![Insurers and plans](screenshots/insurers.png)

Insurers are on the left with the number of policies each holds; plans are on
the right. Common Indian insurers are pre-loaded, so most agencies never add
one.

| Control | What it does |
| --- | --- |
| **Plans** on an insurer's row | Filters the plans panel to that company |
| **Show all** | Returns the plans panel to every company |
| **Show inactive** | Reveals retired insurers and plans |
| **Edit** | Opens the insurer or plan for changes |

## Add an insurer

Press **New insurer**.

![New insurer](screenshots/insurer-new.png)

| Field | Required | Notes |
| --- | --- | --- |
| **Name** | Yes | Exactly as you want it to read on every policy |
| **Short code** | | A quick abbreviation, useful in exports |
| **Claims helpline** | | The number you look up when a client rings about a claim |
| **Support email** | | |
| **Website** | | |
| **Active** | | On by default |

Recording the claims helpline is worth the ten seconds. When a client rings
about a claim, the number is on the screen you are already on.

## Add a plan

Press **Add** on the plans panel.

| Field | Required | Notes |
| --- | --- | --- |
| **Insurer** | Yes | Which company sells it |
| **Plan name** | Yes | The insurer's product name |
| **Category** | Yes | Health, life, motor and the rest |
| **Plan code** | | |
| **Active** | | On by default |

Plans are optional. Recording them lets you see which products your book is
concentrated in, and [importing a file](import-your-book.md) that names plans
creates them for you.

## Retire an insurer or plan

Clear **Active** on either. It drops out of the pickers on new policies while
staying on every policy that already uses it, and nothing in your history
changes.

This is what you want when you stop placing business with a company. Tick **Show
inactive** to see them again and set **Active** to bring one back.

## Delete an insurer or plan

The delete button removes it outright, and asks first. Use it only for a
duplicate you created by accident — retiring is the right answer for a company
you have stopped using.

---

Next: [settings](settings.md).
