[← Guide contents](index.md)

# Install and first run

Getting StayInsured onto the machine, creating the encrypted book, and opening
and closing it safely every day.

- [Install the app](#install-the-app)
- [Create your book](#create-your-book)
- [Unlock it each day](#unlock-it-each-day)
- [Lock, close and quit](#lock-close-and-quit)
- [Get new versions](#get-new-versions)

## Install the app

Download the file for your computer from the
[releases page](https://github.com/laksagent-png/StayInsured/releases).

| System | File | What to do |
| --- | --- | --- |
| macOS | `.dmg` | Open it, drag StayInsured into Applications, then allow the first launch from **System Settings → Privacy & Security** |
| Windows | `.exe` | Run it. When Windows says the publisher is unknown, choose **More info**, then **Run anyway** |

On a Mac the first launch is refused, and the warning has no Open button on it.
Open **System Settings → Privacy & Security** and scroll to the bottom: a line
says StayInsured was blocked, with **Open Anyway** beside it. Press that, confirm
with your Mac password, and the app opens. You do this once.

On macOS 14 and earlier, right-click the app and choose **Open** instead, which
gives you an Open button there and then. Apple removed that shortcut in macOS 15.

Both warnings appear because the app is not registered with Apple and Microsoft,
and neither is a sign that anything is wrong. They only ever appear on the first
install — [updates](#get-new-versions) replace the app without either of them.

The app needs no other software. It carries its own database.

On Windows it needs version 10 build 1803 or newer. The installer checks the
version before it copies anything, and on Windows 7, 8 and 8.1 it explains why it
cannot go on and leaves the machine untouched — those versions cannot run the
Microsoft Edge WebView2 runtime the app draws its screens with.

## Create your book

The first launch asks for two things: your agency name, and a password.

![First run](screenshots/first-run.png)

| Field | Required | Notes |
| --- | --- | --- |
| **Agency name** | Yes | Appears in the app and on client emails. Change it later in [Settings](settings.md) |
| **Password** | Yes | At least eight characters. This encrypts the database |
| **Confirm password** | Yes | Must match |
| **Trust this device** | No | Stores the key in the Keychain (macOS) or Credential Manager (Windows) |

Press **Create encrypted database** and the book is ready to use.

**The password is the key, and there is no reset.** It is not stored anywhere
and nobody — including you — can recover the data without it. Write it down and
keep it where you keep anything else valuable.

Tick **Trust this device** on your own machine and opening the app becomes a
single click. Leave it clear on a shared machine so the password is typed every
time. You can change your mind either way later.

## Unlock it each day

![Unlock](screenshots/unlock.png)

Type the password and press **Unlock**.

On a trusted device the app unlocks itself as it starts. Lock it by hand and it
asks for the password instead, so leaving your desk still shuts the book;
**Use the saved key on this device** opens it again without typing anything.

Unlocking also brings every status in line with today's date, so the renewal
counts you see are the counts as of this morning.

## Lock, close and quit

| Action | What happens |
| --- | --- |
| **Lock app** at the foot of the sidebar | Closes the book and returns to the unlock screen. The app keeps running |
| Closing the window | The app keeps running in the menu bar (macOS) or system tray (Windows) |
| **Open StayInsured** in the tray menu | Brings the window back |
| **Lock now** in the tray menu | Closes the book and brings the window up on the unlock screen |
| **Quit StayInsured** in the tray menu | Shuts the app down properly |

Lock the app whenever you leave your desk. It takes one click and one password
to come back.

## Get new versions

StayInsured looks for a new version each time you open it and unlock your book.
When there is one, it says so:

| Choice | What happens |
| --- | --- |
| **Install now** | Downloads the new version, replaces the app, then offers to restart |
| **Later** | Nothing changes. You are asked again next time you open the app |
| **Restart now**, after installing | Closes and reopens the app on the new version |
| **Later**, after installing | The new version starts the next time you open the app yourself |

You see nothing at all when you are already on the latest version, or when the
machine is offline. There is no button to check by hand — opening the app is the
check.

Updating never touches your book. Clients, policies, settings, templates and
your password all carry over, and the warning you clicked through when you first
installed does not come back.

The version you are running is at the foot of the [Settings](settings.md) screen.

---

Next: [find your way around](getting-around.md), or go straight to
[importing your book](import-your-book.md).
