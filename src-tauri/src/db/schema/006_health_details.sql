-- What a health proposal asks for, and no other category does.
--
-- A health policy is written up off a form of its own: the plan, the variant of
-- it that was sold, the riders bought on top, whether the cover is individual or
-- a floater, how many years were paid for at once, and whether the year is a
-- fresh sale, a port from another insurer or a renewal. None of that fits the
-- columns already here, and an agency that keeps it in the notes cannot answer a
-- question about it.
--
-- The columns sit on `policies` rather than in a health table beside it. Each one
-- describes a single policy year, so a side table would be a second row with the
-- same key, joined on every read, holding one row per health policy and none for
-- anything else. `vehicle_number` is already here on the same reasoning.
--
-- Every column is nullable, and stays nullable. A book that was imported knows
-- none of these, every non-health category leaves them empty, and a `NOT NULL`
-- would have to invent a value for both. What the add-policy screen insists on
-- for a health policy is the screen's own rule; the schema's job is to hold what
-- the agency actually knows.

ALTER TABLE policies ADD COLUMN variant TEXT;

-- The riders bought on top, as a comma-separated list of the words in
-- `util::RIDERS`. A fixed vocabulary of five, chosen per policy year and never
-- filtered, counted or joined on, does not earn a table: `policy_members` is one
-- because a member is a client with a life of their own, and a rider is not.
ALTER TABLE policies ADD COLUMN riders TEXT;

ALTER TABLE policies ADD COLUMN plan_type TEXT
    CHECK (plan_type IS NULL OR plan_type IN ('individual', 'family_floater'));

-- Years of cover bought in one go. Health is sold up to five at a time, and the
-- expiry date the screen works out follows from this.
ALTER TABLE policies ADD COLUMN term INTEGER
    CHECK (term IS NULL OR (term >= 1 AND term <= 5));

-- How the year was written, which is not what `status` says. A policy ported in
-- from another insurer is 'portability' for as long as it exists; 'renewed' is a
-- status, and it means a later year of this chain is in the book.
ALTER TABLE policies ADD COLUMN policy_type TEXT
    CHECK (policy_type IS NULL OR policy_type IN ('fresh', 'portability', 'renewal'));

-- Who the business was placed through. A free text field rather than a reference
-- to a table, because the broker is not an entity the app manages.
ALTER TABLE policies ADD COLUMN broker TEXT;

-- A rider the plan already carries, as against the ones in `riders` that were
-- bought on top. Written the way the insurer names it.
ALTER TABLE policies ADD COLUMN inbuilt_rider TEXT;

-- The view names its columns one by one, so it cannot see a column added after
-- it was created. Rebuilt rather than altered: SQLite has no ALTER VIEW, and
-- both editions read this file.
DROP VIEW policy_overview;

CREATE VIEW policy_overview AS
SELECT p.id,
       p.chain_id,
       p.policy_year,
       p.previous_policy_id,
       p.policy_number,
       p.client_id,
       c.client_code,
       c.full_name        AS client_name,
       c.email            AS client_email,
       c.phone            AS client_phone,
       c.city             AS client_city,
       c.reminders_opted_out,
       p.insurer_id,
       i.name             AS insurer_name,
       p.product_id,
       pr.name            AS product_name,
       p.category,
       p.status,
       p.start_date,
       p.expiry_date,
       p.sum_insured,
       p.premium_amount,
       p.gst_amount,
       p.premium_frequency,
       p.payment_mode,
       p.next_due_date,
       p.commission_rate,
       p.commission_expected,
       p.nominee_name,
       p.nominee_relation,
       p.vehicle_number,
       p.variant,
       p.riders,
       p.plan_type,
       p.term,
       p.policy_type,
       p.broker,
       p.inbuilt_rider,
       p.notes,
       p.created_at,
       p.updated_at,
       CAST(julianday(p.expiry_date) - julianday(date('now', 'localtime')) AS INTEGER)
                          AS days_to_expiry,
       EXISTS (SELECT 1 FROM policies s WHERE s.previous_policy_id = p.id)
                          AS is_renewed
FROM policies p
JOIN clients  c  ON c.id = p.client_id
JOIN insurers i  ON i.id = p.insurer_id
LEFT JOIN products pr ON pr.id = p.product_id;
