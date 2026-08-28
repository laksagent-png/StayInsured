-- What a motor proposal asks for, and no other category does.
--
-- A motor policy is written up off the vehicle rather than off the life: what
-- kind of vehicle it is, who built it and when, and the three numbers that
-- identify it — registration, engine, chassis. `vehicle_number` has held the
-- registration since the book began; everything beside it lived in the notes,
-- where no one could sort by it or answer a question about it.
--
-- The other half is that motor cover is two covers sold together. Own damage
-- and third party each run for their own stretch of time and each carry their
-- own premium, and which of the two a policy has is decided by the cover type:
-- a bundle carries both, a standalone own-damage policy carries no third party,
-- and a liability policy carries nothing else.
--
-- The columns sit on `policies` for the reason `006_health_details.sql` gives:
-- each describes a single policy year, so a side table would be a second row
-- with the same key, joined on every read and empty for every category but one.
--
-- Every column is nullable, and stays nullable. A book that was imported knows
-- none of these, every non-motor category leaves them empty, and a `NOT NULL`
-- would have to invent a value for both. What the add-policy screen insists on
-- for a motor policy is the screen's own rule; the schema's job is to hold what
-- the agency actually knows.

-- What is insured. The words match `util::VEHICLE_TYPES`, and two of them bring
-- a further question with them: see the two columns below.
ALTER TABLE policies ADD COLUMN vehicle_type TEXT
    CHECK (vehicle_type IS NULL OR vehicle_type IN ('pvt_car', 'goods_carrying',
                                                    'passenger', 'two_wheeler'));

-- Gross vehicle weight in kilograms, which a goods carrying vehicle is rated
-- on and nothing else is. Held to the vehicle that has one by the repository
-- rather than by a CHECK, because a CHECK cannot see a column being written in
-- the same statement as this one.
ALTER TABLE policies ADD COLUMN gross_vehicle_weight REAL
    CHECK (gross_vehicle_weight IS NULL OR gross_vehicle_weight > 0);

-- Seats, which a passenger vehicle is rated on. Same reasoning.
ALTER TABLE policies ADD COLUMN passenger_capacity INTEGER
    CHECK (passenger_capacity IS NULL OR passenger_capacity >= 1);

ALTER TABLE policies ADD COLUMN vehicle_manufacturer TEXT;

-- Make and model as one field, because that is how the registration
-- certificate writes it and how the agent reads it back.
ALTER TABLE policies ADD COLUMN vehicle_model TEXT;

-- The upper bound is a typo guard rather than a rule about vehicles: it catches
-- a year typed with an extra digit, which would otherwise sort a policy to the
-- far end of every list that shows it.
ALTER TABLE policies ADD COLUMN manufacture_year INTEGER
    CHECK (manufacture_year IS NULL OR (manufacture_year >= 1900 AND manufacture_year <= 2100));

ALTER TABLE policies ADD COLUMN engine_number TEXT;
ALTER TABLE policies ADD COLUMN chassis_number TEXT;

-- Which covers were sold, which is what decides whether the four dates and two
-- premiums below apply. Not `policy_type`: that says how a year was written —
-- fresh, ported or renewed — and a motor policy has both answers at once.
ALTER TABLE policies ADD COLUMN cover_type TEXT
    CHECK (cover_type IS NULL OR cover_type IN ('bundle_1_3', 'bundle_3_3', 'standalone_od',
                                                'package', 'liability'));

-- The two risk periods. `start_date` and `expiry_date` still say when the
-- policy runs, and for a motor policy the repository works them out from these:
-- the earliest cover to start and the earliest to end, so the renewals desk
-- chases whichever half lapses first. A 1+3 bundle turns up on the desk after
-- its first year, which is when its own damage cover has to be bought again.
ALTER TABLE policies ADD COLUMN od_start_date TEXT;
ALTER TABLE policies ADD COLUMN od_end_date   TEXT;
ALTER TABLE policies ADD COLUMN tp_start_date TEXT;
ALTER TABLE policies ADD COLUMN tp_end_date   TEXT;

-- What each half cost. `premium_amount` stays the figure the agency accounts
-- on, and for a motor policy the screen adds these two into it.
ALTER TABLE policies ADD COLUMN od_premium REAL;
ALTER TABLE policies ADD COLUMN tp_premium REAL;

-- Registration, engine and chassis numbers are what an agent searches by when
-- a claim comes in with no policy number attached.
CREATE INDEX idx_policies_engine  ON policies (engine_number);
CREATE INDEX idx_policies_chassis ON policies (chassis_number);

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
       p.vehicle_type,
       p.gross_vehicle_weight,
       p.passenger_capacity,
       p.vehicle_manufacturer,
       p.vehicle_model,
       p.manufacture_year,
       p.engine_number,
       p.chassis_number,
       p.cover_type,
       p.od_start_date,
       p.od_end_date,
       p.tp_start_date,
       p.tp_end_date,
       p.od_premium,
       p.tp_premium,
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
