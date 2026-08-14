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

Nothing on this screen leaves your machine.

## Your agency

| Field | What it affects |
| --- | --- |
| **Agency name** | The sidebar and the signature on client emails |
| **Contact email** | Client emails |
| **Contact phone** | Client emails |
| **Address** | Client emails |
| **Expiring soon window** | How many days ahead count as "expiring soon" on the dashboard |
| **Currency** | How amounts are shown across the app |

Set **Expiring soon window** to how far ahead you actually start chasing. Thirty
days suits most agencies; set it to 45 if you work further out, and the
dashboard follows you.

## Change your password

Enter **Current password**, then the new one in **New password** and **Confirm
new**, and press **Change password**.

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
| **Daily send cap** | How many to send in a day, because mailbox providers throttle bulk sending. The rest wait for tomorrow |
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
| **Server** and **Port** | Your provider's SMTP details. Gmail is `smtp.gmail.com` on 587 |
| **Username** | Usually your full email address |
| **Password** | Kept in the system keychain, never in the database or a backup |
| **Send as** | The address clients see and reply to |
| **Shown as** | The name beside it, usually your agency |
| **Security** | STARTTLS for port 587, TLS for 465 |

Most providers will not accept your normal password from an app. Create an app
password in your mail account and use that.

Press **Send test** to send one message to the address beside the button. It
saves what is on screen first, so you are testing what you can see. A wrong
password is reported here rather than turning up as a queue full of failures.

---

Next: [backups and your data](backups-and-data.md).
