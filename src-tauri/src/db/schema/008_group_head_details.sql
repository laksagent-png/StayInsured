-- The group head is a person to ring, not a client to look up.
--
-- 007 recorded headship as `head_client_id`, a foreign key into `clients`. That
-- assumed the person who introduced a group is themselves somebody the agency
-- insures, and mostly they are not. A referrer is a broker who passes work
-- across, an HR manager at the parent company, an accountant who recommends you
-- to their clients. Making them a client to record them means opening a client
-- record for somebody who will never hold a policy, which pollutes the client
-- list, the client count, the dashboard and every export with people who are
-- not the book.
--
-- So the head is held as what it is: a name and a way of reaching them, written
-- on the group. Four columns rather than a join, all nullable, because an agent
-- may know the firm files together long before they can say who introduced it —
-- and because a spreadsheet import knows the grouping and never the
-- introduction.
--
-- What is lost is deliberate. There is no longer a link from a group to a client
-- page, and no way to ask a client which groups they referred, because a
-- referrer is no longer a client. What is kept is the thing the agent actually
-- used: the name in the group list, now with a phone number beside it.

ALTER TABLE client_groups ADD COLUMN head_name TEXT;
ALTER TABLE client_groups ADD COLUMN head_designation TEXT;
ALTER TABLE client_groups ADD COLUMN head_phone TEXT;
ALTER TABLE client_groups ADD COLUMN head_email TEXT;

-- Carry across what the old link can still answer. A group whose head was a
-- client keeps that person by name and contact rather than losing them to the
-- schema change; a group whose referrer had already been deleted stays blank,
-- which is the state it was already in.
--
-- Designation has no source here on purpose. A client's `contact_designation`
-- is the title of the person to ask for at a company, not the title of the
-- client themselves, so copying it would put a stranger's job title against the
-- referrer's name.
UPDATE client_groups
   SET head_name  = (SELECT c.full_name FROM clients c WHERE c.id = client_groups.head_client_id),
       head_phone = (SELECT c.phone     FROM clients c WHERE c.id = client_groups.head_client_id),
       head_email = (SELECT c.email     FROM clients c WHERE c.id = client_groups.head_client_id)
 WHERE head_client_id IS NOT NULL;

-- SQLite refuses to drop an indexed column, so the index goes first. Both
-- editions are well past 3.35, where DROP COLUMN arrived: the app builds against
-- libsqlite3-sys 0.38, and the Windows 7 edition's better-sqlite3 8.7 carries
-- 3.43. Neither needs the twelve-step table rebuild, which is worth avoiding
-- here because `clients.group_id` points at this table and a rebuild would have
-- to be careful about that.
DROP INDEX idx_groups_head;

ALTER TABLE client_groups DROP COLUMN head_client_id;

-- Searching a group by its referrer is now a scan of this column rather than a
-- join, and the table is small enough that this index is about the list staying
-- honest when a book has many groups rather than about any measured cost.
CREATE INDEX idx_groups_head_name ON client_groups (head_name);
