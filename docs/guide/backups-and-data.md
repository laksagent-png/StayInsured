[← Guide contents](index.md)

# Backups and your data

Your whole book is one encrypted file on your computer. That makes a backup a
copy of that file — and makes taking one your responsibility, because there is
no server holding a second copy.

- [Take a backup](#take-a-backup)
- [Keep a copy off the machine](#keep-a-copy-off-the-machine)
- [How many are kept](#how-many-are-kept)
- [Where your data lives](#where-your-data-lives)
- [Restore a backup](#restore-a-backup)
- [Move to another computer](#move-to-another-computer)

## Take a backup

**Settings → Back up now** writes a backup immediately, named for the moment it
was taken (`stayinsured-20260814-093000.db`).

The copy is encrypted with the same password as the live book, which is what
makes it safe to keep in cloud storage. It is also a consistent snapshot, so you
can take one with the app open and work in progress. Scans you have attached are
inside the book, so the backup carries those too.

Take one before anything large: a big [import](import-your-book.md), a password
change, or a machine upgrade. **Back up now** is a button rather than a setting,
so it writes the copy the moment you press it and there is nothing to save
first.

The card sits inside the settings screen. When the settings cannot be read,
**The settings could not be read** stands where the cards would be with a **Try
again** button, and neither **Back up now** nor **Open data folder** is on screen
until that read succeeds.

## Keep a copy off the machine

**Copy backups to** takes a folder path. Point it at your Google Drive, OneDrive
or Dropbox folder and every backup is mirrored there automatically.

Do this. A backup that only exists on the laptop is no backup at all if the
laptop is lost, and the file is encrypted, so a cloud folder is a safe place for
it.

The path is a setting, so press **Save changes** at the top of the screen once
you have typed it; the next backup is the first one copied. Give it a folder
that already exists — when the path is not one, the backup is still written on
this machine and the copy is skipped without a word.

## How many are kept

**Backups to keep** decides how many are retained before the oldest is dropped.
Fourteen is the default and suits daily backups with a fortnight of history.

It takes a whole number of 1 or more. Anything else — an empty box, a zero, a
negative count — is refused with **Keep at least one backup** under the box, and
**Save changes** is unavailable until you put a usable number back. The button is
also grey until something on the screen has been edited, so a screen you have
only read has nothing to save.

Only the `backups/` folder on this machine is pruned. Copies mirrored to a
synced folder stay there until you remove them yourself, which is worth knowing
before you point this at a drive you are short of room on.

## Where your data lives

**Open data folder** in Settings takes you straight there. When your system will
not open it, the app says why rather than appearing to do nothing, and the path
is printed under the buttons so you can reach it by hand.

| System | Folder |
| --- | --- |
| macOS | `~/Library/Application Support/com.stayinsured.app` |
| Windows | `%APPDATA%\com.stayinsured.app` |
| Linux | `~/.local/share/com.stayinsured.app` |

| Inside | What it is |
| --- | --- |
| `stayinsured.db` | Your book — clients, policies, [documents](documents.md), everything |
| `vault.json` | The encryption parameters. Useless without your password, but required with it |
| `backups/` | Every backup taken on this machine |
| `logs/` | Diagnostics, useful when reporting a problem |

Everything the app writes is under that one folder, which is why moving it is a
folder copy.

## Restore a backup

1. Quit StayInsured from the menu bar or tray.
2. Open the data folder.
3. Rename `stayinsured.db` to `stayinsured-old.db` — do not delete it until the
   restore has worked.
4. Copy the backup you want out of `backups/` and rename the copy to
   `stayinsured.db`.
5. Start the app and unlock with the password that was in use when that backup
   was taken.

If the password has changed since, use the password from the day of the backup.
The file carries the encryption it was written with.

## Move to another computer

1. Take a backup on the old machine.
2. Copy the whole data folder to the same location on the new one.
3. Install StayInsured on the new machine and start it.
4. Unlock with your password. The book is exactly as you left it.

Copy the folder, not only the database: `vault.json` travels with it.

Only copy the folder while the app is closed on both machines. Two copies of the
app running against a shared folder is not supported, and the second one to save
wins.

---

Next: [reference](reference.md).
