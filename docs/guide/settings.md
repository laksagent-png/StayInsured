[← Guide contents](index.md)

# Settings

Your agency details, your password, and the preferences that shape the rest of
the app, at `/settings`. Backups have [their own page](backups-and-data.md).

- [Saving changes](#saving-changes)
- [Your agency](#your-agency)
- [Change your password](#change-your-password)
- [Stop trusting this device](#stop-trusting-this-device)
- [Reminders](#reminders)
- [Sending email](#sending-email)

## Saving changes

![Settings](screenshots/settings.png)

**Save changes** at the top right commits the whole screen. Make all your edits,
then save once.

Every number on this screen states the range it accepts and refuses anything
outside it, with the reason in red under the box. **Save changes** is unavailable
while any of them is wrong, so a value the app would only ignore never reaches
the book.

When the settings themselves cannot be read, **The settings could not be read**
stands where the cards would be, with the reason underneath and a **Try again**
button. There is nothing to save until they arrive, so the button stays
unavailable.

Nothing on this screen leaves your machine.

## Your agency

| Field | What it affects |
| --- | --- |
| **Agency name** | The sidebar and the signature on client emails |
| **Contact email** | Client emails |
| **Contact phone** | Client emails |
| **Address** | Client emails |
| **Expiring soon window** | How many days ahead count as "expiring soon" in your daily digest and desktop alert |
| **Currency** | How amounts are shown across the app |

Set **Expiring soon window** to how far ahead you actually start chasing. Thirty
days suits most agencies; set it to 45 if you work further out, and the daily
digest, the desktop alert and the warning about clients with no email address on
the [Reminders](reminders.md) screen all widen with it. It takes a whole number
of days between 1 and 365 and says so under the box when it is given anything
else.

## Change your password

Enter **Current password**, then the new one in **New password** and **Confirm
new**, and press **Change password**.

**Change password** waits until the three boxes agree. A new password shorter
than eight characters is refused under **New password**, and a confirmation that
does not match it is refused under **Confirm new**.

The database is re-encrypted as part of this, so the app is busy for a moment.
Do it when you are not mid-month-end.

The new password is the only key from then on. There is still no reset, so write
it down before you change it.

## Stop trusting this device

**Stop trusting this device** removes the key held in the Keychain (macOS) or
Credential Manager (Windows). The app asks for the password next time it opens.

Press it before handing the machine to anyone — a repair shop, a colleague, or
a buyer.

Tick **Trust this device** on the unlock screen to set it up again.

## Reminders

This card controls the daily run. What it sends, and when, is set up under
[Reminders](reminders.md).

| Setting | Meaning |
| --- | --- |
| **Send reminders automatically** | Turns the daily run on. Off means nothing goes out unless you press **Send now** |
| **Send reminders at** | The time of day the run happens |
| **Daily send cap** | How many to send in a day, because mailbox providers throttle bulk sending. The rest wait for tomorrow. A whole number, and 0 to send none |
| **Practice mode: work everything out but send nothing** | Leave it on until the wording and the timing look right |
| **Start StayInsured at login** | Needed for reminders to fire when the window is closed |
| **Show desktop alerts for the day's expiries** | A notification on this computer when policies expire |
| **Email me a daily digest of what is expiring** | One summary a day, to your contact email |

The run happens at the time you set, once a day, as long as the app is running —
the window can be closed, since it stays in the menu bar. If the machine was
asleep at that time, the run happens as soon as it wakes.

## Sending email

Reminders go out through your own mailbox, so replies come back to you and no
third party holds your client list.

| Setting | Meaning |
| --- | --- |
| **Server** and **Port** | Your provider's SMTP details. Gmail is `smtp.gmail.com` on 587. The port is a number between 1 and 65535 |
| **Username** | Usually your full email address |
| **Password** | Kept in the system keychain, never in the database or a backup |
| **Send as** | The address clients see and reply to |
| **Shown as** | The name beside it, usually your agency |
| **Security** | STARTTLS for port 587, TLS for 465, and None only for a local test server |

Most providers will not accept your normal password from an app. Create an app
password in your mail account and use that. The box shows dots and the words
**Saved in the system keychain** once one is held; type a new one over it to
replace it.

**Remove password** sits under the box while a password is stored, and takes it
out of the keychain — say, when you change mail accounts or hand the machine on.
The app answers **The mail password is out of the keychain**, and the
[Reminders](reminders.md) screen then warns that sending will be refused until
you put one back.

Press **Send test** to send one message to the address beside the button. It
saves what is on screen first, so you are testing what you can see. An address
that is not an email address is refused before any of that, so a typo beside the
button stores nothing. A wrong password is reported here rather than turning up
as a queue full of failures.

---

Next: [backups and your data](backups-and-data.md).
