-- Editing a client could be refused with "database disk image is malformed".
--
-- clients_touch and clients_fts_au are both AFTER UPDATE ON clients, and SQLite
-- does not promise an order for those; in practice it runs them newest first, so
-- the touch trigger goes before the index one. Its UPDATE clients SET updated_at
-- runs the index trigger a second time, and that second run sees old and new both
-- holding the row as it now stands. The index is therefore told to delete a row
-- image it never held.
--
-- FTS5 keeps a running word count per column for the whole table and subtracts
-- the deleted image from it. When the row being saved has more words in some
-- column than the entire book has recorded there, that count would go below zero,
-- FTS5 declares the table corrupt and the save is rolled back. Which is why the
-- fault looked so arbitrary: it is certain on a column no client has filled in --
-- pan, usually, or email at an agency that works by phone -- and on a book with
-- only a handful of clients, and it is invisible on a large one, where the
-- spurious delete and the spurious insert cancel each other out and only cost two
-- wasted index writes per edit.
--
-- The WHEN clause below closes it. The index trigger now fires only when one of
-- the five indexed columns really changed, so an update that moves nothing but
-- updated_at cannot re-enter it. Swapping the two triggers' creation order would
-- also work on the SQLite we ship today, but it would rest on that unpromised
-- ordering, and the Windows 7 edition reads these same files into a different and
-- older SQLite. This way also spares the index a rewrite every time someone
-- corrects an address or adds a note.

DROP TRIGGER clients_fts_au;

CREATE TRIGGER clients_fts_au AFTER UPDATE ON clients
WHEN old.full_name   IS NOT new.full_name
  OR old.email       IS NOT new.email
  OR old.phone       IS NOT new.phone
  OR old.client_code IS NOT new.client_code
  OR old.pan         IS NOT new.pan
BEGIN
    INSERT INTO clients_fts (clients_fts, rowid, full_name, email, phone, client_code, pan)
    VALUES ('delete', old.id, old.full_name, old.email, old.phone, old.client_code, old.pan);
    INSERT INTO clients_fts (rowid, full_name, email, phone, client_code, pan)
    VALUES (new.id, new.full_name, new.email, new.phone, new.client_code, new.pan);
END;

-- A corrected trigger does nothing for a book that has already been edited, and
-- there is no cheap way to tell a good index from a bad one: FTS5's
-- integrity-check reads the index against itself, not against the clients table,
-- so an index that disagrees with the book passes it. Rebuilding reads the client
-- list once and settles the question for every book, whichever edition wrote it.
INSERT INTO clients_fts (clients_fts) VALUES ('rebuild');

-- policies_touch has the same shape, but there is no search index on policies for
-- it to disturb -- policy search is a LIKE over policy_overview. If one is ever
-- added, its update trigger needs the WHEN clause above from the start.
