-- A client is not always a person, and a group is not a family.
--
-- The book was built for people. A company buying group health for its staff is
-- the same kind of client -- it holds policies, it renews, it gets chased -- but
-- it has no date of birth and no gender, and the name to put on a phone call is
-- not the name on the policy. `kind` separates the two, and the corporate
-- columns beside it hold what a company has instead: the person who answers,
-- what they do there, and the registration number the insurer asks for.
--
-- Groups are the other half. Companies arrive in bunches -- a holding company's
-- subsidiaries, or ten unrelated firms that all came through the same
-- introducer -- and the agency works them as one book. `client_groups` is that
-- bunch, and `clients.group_id` says who is in it.
--
-- A group is a table where a family is not, and the difference is not an
-- inconsistency. A family has no boundary: it is whoever the relationship edges
-- reach, a person belongs to several at once, and nothing may choose between
-- them, which is why `client_relations` has no container and why the family
-- archive stops one step out. A group has exactly the boundary a family lacks.
-- It is named, it is entered deliberately, a company sits in one of them, and
-- the operator can say where it ends. Storing it as a row is what lets a group
-- be archived, listed, reported on and deleted as itself.
--
-- `head_client_id` is the referrer: whoever introduced the group. They are a
-- client, so the book holds their number and can chase them, but they need not
-- be in the group they brought in -- a broker who placed ten firms is nobody's
-- subsidiary. That is why headship and membership are separate columns rather
-- than one flag, and why archiving a group moves its members and leaves the
-- referrer alone.
--
-- Both new links let go rather than cascade. A group is a filing arrangement,
-- not an owner: deleting the folder must not delete the companies, and losing
-- the referrer must not lose the group. This is the opposite of `client_relations`,
-- where the edge dies with either person because an edge between two people is
-- nothing once one of them is gone.
--
-- Every column added here is nullable or carries a constant default, so each
-- ALTER is one the older SQLite behind the Windows 7 edition accepts. A
-- migration is written once but has to work twice.

CREATE TABLE client_groups (
    id             INTEGER PRIMARY KEY,
    group_code     TEXT    NOT NULL UNIQUE,
    name           TEXT    NOT NULL UNIQUE,
    -- The referrer. Nullable so that losing them degrades to a group with no
    -- introducer on file rather than taking the group with it; the repository
    -- asks for one when the group is opened.
    head_client_id INTEGER REFERENCES clients (id) ON DELETE SET NULL,
    notes          TEXT,
    is_archived    INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_groups_head     ON client_groups (head_client_id);
CREATE INDEX idx_groups_archived ON client_groups (is_archived);

-- Harmless in the way policies_touch is harmless: nothing indexes client_groups,
-- so this trigger cannot re-enter an FTS trigger the way one on `clients` would.
-- A client_groups_fts added later would need the same WHEN clause 004 gave
-- clients_fts_au.
CREATE TRIGGER client_groups_touch AFTER UPDATE ON client_groups BEGIN
    UPDATE client_groups SET updated_at = datetime('now') WHERE id = new.id;
END;

ALTER TABLE clients ADD COLUMN kind TEXT NOT NULL DEFAULT 'individual'
    CHECK (kind IN ('individual', 'company'));

ALTER TABLE clients ADD COLUMN group_id INTEGER REFERENCES client_groups (id) ON DELETE SET NULL;

-- Who to ask for, and what to call them. A company's `full_name` is the entity
-- on the policy; these are the human on the other end of it.
ALTER TABLE clients ADD COLUMN contact_person TEXT;
ALTER TABLE clients ADD COLUMN contact_designation TEXT;

-- CIN, LLPIN or whatever the registrar issued. PAN and GSTIN are already here
-- and mean the same thing for a company as for a person.
ALTER TABLE clients ADD COLUMN registration_no TEXT;

CREATE INDEX idx_clients_group ON clients (group_id);
CREATE INDEX idx_clients_kind  ON clients (kind);
