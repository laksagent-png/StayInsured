-- A member of a client's family is a client.
--
-- insured_members held the spouse, the children and the parents as a shadow
-- record: a name, a relationship and a date of birth, owned by one client and
-- reachable from nowhere else. That shape cannot answer the questions an agency
-- actually asks. A son who buys his own motor policy has to be entered a second
-- time as a client, and the two rows never learn about each other. A wife
-- covered on her husband's floater and holding her own term plan is two people
-- in the book. And a family only ever extends one level: the member rows hang
-- off a client and members cannot relate to each other, so the household stops
-- at whoever happens to hold the policy.
--
-- So members move into clients, and the relationship becomes an edge between two
-- client rows. One person is one row in the book however they entered it, a
-- family is a graph that can be walked in either direction to any depth, and
-- somebody who starts as a dependent becomes a policyholder by having a policy
-- written against the row that already exists.
--
-- The migration has to decide, for every existing member row, which client they
-- are. Three cases, in order, so the narrowest wins:
--
--   1. relationship = 'self' is the client themselves, recorded a second time to
--      get onto their own floater. It maps to the owning client.
--   2. A name matching exactly one client is that client. This is the wife who
--      was entered both ways, and merging them is the point of the change. The
--      match has to be unique to count: two clients sharing a name are two
--      people until an operator says otherwise, and a wrong merge is not
--      something a later migration can take back.
--   3. Everyone else becomes a new client, allocated the next CL- code.
--
-- Where a merge finds the client row blank and the member row filled -- a date of
-- birth, most often, because a floater has to be priced off everyone's age while
-- a client can be opened with a name and a phone number -- the member's answer is
-- copied up before the row goes.
--
-- Promoted members inherit the household's address, city, state, pincode and
-- language, because a dependent lives where the policyholder lives and the
-- client list filters and sorts on those columns. They do not inherit email or
-- phone: that is the policyholder's own contact, copying it would put every
-- dependent into the "missing email" filter's blind spot, and reminders are
-- addressed per policy, so a shared inbox would be chased once per family
-- member.
--
-- Written without window functions or recursive CTEs. The Windows 7 edition
-- reads these same files into an older SQLite, and a migration is written once
-- but has to work twice.

CREATE TABLE client_relations (
    client_id         INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    related_client_id INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    -- Reads as "related_client_id is the relationship of client_id", which is the
    -- direction insured_members.relationship already meant.
    relationship      TEXT    NOT NULL DEFAULT 'other'
                              CHECK (relationship IN ('spouse', 'son', 'daughter',
                                                      'father', 'mother', 'brother',
                                                      'sister', 'other')),
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    -- One edge per ordered pair. The reverse direction is derived for display
    -- rather than stored, so there is no second row to keep in agreement; the
    -- repository checks both directions before inserting.
    PRIMARY KEY (client_id, related_client_id),
    -- 'self' is gone from the vocabulary. A client does not relate to themselves.
    CHECK (client_id <> related_client_id)
);

CREATE INDEX idx_relations_related ON client_relations (related_client_id);

-- Which client each member row turns out to be. What the member row knew is
-- carried along with it, so that the gap-fill further down reads one table and
-- the merge cases and the new-client case can be filled by the same statements.
CREATE TABLE member_promotion (
    member_id     INTEGER PRIMARY KEY,
    owner_id      INTEGER NOT NULL,
    relationship  TEXT    NOT NULL,
    client_id     INTEGER,
    date_of_birth TEXT,
    gender        TEXT,
    notes         TEXT
);

-- Case 1: the client, recorded twice.
INSERT INTO member_promotion (member_id, owner_id, relationship, client_id,
                              date_of_birth, gender, notes)
SELECT m.id, m.client_id, m.relationship, m.client_id,
       m.date_of_birth, m.gender, m.notes
FROM insured_members m
WHERE m.relationship = 'self';

-- Case 2: already in the book under their own name, unambiguously.
INSERT INTO member_promotion (member_id, owner_id, relationship, client_id,
                              date_of_birth, gender, notes)
SELECT m.id, m.client_id, m.relationship,
       (SELECT c.id FROM clients c WHERE lower(c.full_name) = lower(m.full_name)),
       m.date_of_birth, m.gender, m.notes
FROM insured_members m
WHERE m.relationship <> 'self'
  AND (SELECT COUNT(*) FROM clients c WHERE lower(c.full_name) = lower(m.full_name)) = 1;

-- Case 3: a new client each. The code is allocated in one pass here rather than
-- row by row, counting how many still-unpromoted members sort at or before this
-- one and adding that to the highest CL- number the book already holds. Held in
-- its own table because the count cannot read the table it is filling.
CREATE TABLE member_pending (id INTEGER PRIMARY KEY);

INSERT INTO member_pending (id)
SELECT id FROM insured_members
WHERE id NOT IN (SELECT member_id FROM member_promotion);

-- The household columns are carried in here too, so that the insert below reads
-- only these two tables. An INSERT whose SELECT reads the table being written is
-- something SQLite copes with rather than something it promises, and this file
-- has to behave the same in both editions' SQLite.
CREATE TABLE member_new_client (
    member_id     INTEGER PRIMARY KEY,
    client_code   TEXT    NOT NULL,
    address_line1 TEXT,
    address_line2 TEXT,
    city          TEXT,
    state         TEXT,
    pincode       TEXT,
    language      TEXT    NOT NULL
);

INSERT INTO member_new_client (member_id, client_code, address_line1, address_line2,
                               city, state, pincode, language)
SELECT p.id,
       printf('CL-%05d',
              (SELECT IFNULL(MAX(CAST(substr(client_code, 4) AS INTEGER)), 0)
                 FROM clients WHERE client_code GLOB 'CL-[0-9]*')
              + (SELECT COUNT(*) FROM member_pending e WHERE e.id <= p.id)),
       o.address_line1, o.address_line2, o.city, o.state, o.pincode,
       o.preferred_language
FROM member_pending    p
JOIN insured_members   m ON m.id = p.id
JOIN clients           o ON o.id = m.client_id;

INSERT INTO clients (client_code, full_name, date_of_birth, gender, notes,
                     address_line1, address_line2, city, state, pincode,
                     preferred_language)
SELECT n.client_code, m.full_name, m.date_of_birth, m.gender, m.notes,
       n.address_line1, n.address_line2, n.city, n.state, n.pincode, n.language
FROM member_new_client n
JOIN insured_members   m ON m.id = n.member_id;

INSERT INTO member_promotion (member_id, owner_id, relationship, client_id,
                              date_of_birth, gender, notes)
SELECT m.id, m.client_id, m.relationship, c.id,
       m.date_of_birth, m.gender, m.notes
FROM member_new_client n
JOIN insured_members m ON m.id = n.member_id
JOIN clients         c ON c.client_code = n.client_code;

-- What the member row knew and the client row it merges into does not. A person
-- entered twice was often fuller as a dependent than as a client -- a floater
-- needs everyone's date of birth to be priced, where a client can be opened with
-- a name and a phone number -- and that detail is the reason to merge rather
-- than something to discard on the way. Blank fields only: the client row is the
-- authority wherever it has an answer. Case 3 clients were created from these
-- same values, so all three statements are no-ops for them.
UPDATE clients
SET date_of_birth = COALESCE(date_of_birth,
        (SELECT p.date_of_birth FROM member_promotion p
          WHERE p.client_id = clients.id AND p.date_of_birth IS NOT NULL
          ORDER BY p.member_id LIMIT 1)),
    gender = COALESCE(gender,
        (SELECT p.gender FROM member_promotion p
          WHERE p.client_id = clients.id AND p.gender IS NOT NULL
          ORDER BY p.member_id LIMIT 1))
WHERE id IN (SELECT client_id FROM member_promotion WHERE client_id IS NOT NULL);

UPDATE clients
SET notes = (SELECT p.notes FROM member_promotion p
              WHERE p.client_id = clients.id AND p.notes IS NOT NULL
              ORDER BY p.member_id LIMIT 1)
WHERE notes IS NULL
  AND id IN (SELECT client_id FROM member_promotion
              WHERE client_id IS NOT NULL AND notes IS NOT NULL);

-- A note on the client is not a reason to lose the note on the member row, so
-- this one appends. The instr guard keeps it from repeating a note the client
-- already carries, which is what makes running it after the fill above safe.
UPDATE clients
SET notes = notes || char(10) ||
        (SELECT p.notes FROM member_promotion p
          WHERE p.client_id = clients.id AND p.notes IS NOT NULL
            AND instr(clients.notes, p.notes) = 0
          ORDER BY p.member_id LIMIT 1)
WHERE notes IS NOT NULL
  AND EXISTS (SELECT 1 FROM member_promotion p
               WHERE p.client_id = clients.id AND p.notes IS NOT NULL
                 AND instr(clients.notes, p.notes) = 0);

-- The household, as edges. Case 1 mapped a member onto their own owner, so those
-- rows fall out here rather than becoming a client related to itself.
INSERT OR IGNORE INTO client_relations (client_id, related_client_id, relationship)
SELECT p.owner_id, p.client_id, p.relationship
FROM member_promotion p
WHERE p.client_id IS NOT NULL
  AND p.client_id <> p.owner_id;

-- Who a policy year covers is now a client, and may be the policyholder: that is
-- what the 'self' member rows were standing in for. Rebuilt rather than altered,
-- so the shape does not depend on which SQLite is reading the file. The child
-- goes before the parent because foreign keys are enforced and a migration
-- cannot turn them off inside its transaction.
CREATE TABLE policy_members_carry (
    policy_id         INTEGER NOT NULL,
    insured_client_id INTEGER NOT NULL,
    PRIMARY KEY (policy_id, insured_client_id)
);

INSERT OR IGNORE INTO policy_members_carry (policy_id, insured_client_id)
SELECT pm.policy_id, p.client_id
FROM policy_members  pm
JOIN member_promotion p ON p.member_id = pm.member_id
WHERE p.client_id IS NOT NULL;

DROP TABLE policy_members;

CREATE TABLE policy_members (
    policy_id         INTEGER NOT NULL REFERENCES policies (id) ON DELETE CASCADE,
    insured_client_id INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    PRIMARY KEY (policy_id, insured_client_id)
);

-- "Which policies cover this person" is the question the family tree asks of
-- every row it draws, and it reads this the wrong way round.
CREATE INDEX idx_policy_members_client ON policy_members (insured_client_id);

INSERT INTO policy_members (policy_id, insured_client_id)
SELECT policy_id, insured_client_id FROM policy_members_carry;

DROP TABLE policy_members_carry;
DROP TABLE insured_members;
DROP TABLE member_promotion;
DROP TABLE member_new_client;
DROP TABLE member_pending;
