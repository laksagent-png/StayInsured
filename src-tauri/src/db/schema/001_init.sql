-- StayInsured initial schema.
--
-- Design note: a policy is never mutated on renewal. Each policy year is its own
-- row, linked backwards through previous_policy_id and sharing a chain_id across
-- the whole lineage. That preserves the annual record and makes renewal/lapse
-- reporting a straight query instead of an audit-trail reconstruction.

CREATE TABLE users (
    id              INTEGER PRIMARY KEY,
    username        TEXT    NOT NULL UNIQUE,
    display_name    TEXT    NOT NULL,
    password_hash   TEXT    NOT NULL,
    role            TEXT    NOT NULL DEFAULT 'owner'
                            CHECK (role IN ('owner', 'staff', 'readonly')),
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login_at   TEXT
);

CREATE TABLE settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE clients (
    id                  INTEGER PRIMARY KEY,
    client_code         TEXT    NOT NULL UNIQUE,
    full_name           TEXT    NOT NULL,
    email               TEXT,
    phone               TEXT,
    alt_phone           TEXT,
    date_of_birth       TEXT,
    gender              TEXT    CHECK (gender IS NULL OR gender IN ('male', 'female', 'other')),
    address_line1       TEXT,
    address_line2       TEXT,
    city                TEXT,
    state               TEXT,
    pincode             TEXT,
    occupation          TEXT,
    pan                 TEXT,
    gstin               TEXT,
    preferred_language  TEXT    NOT NULL DEFAULT 'en',
    reminders_opted_out INTEGER NOT NULL DEFAULT 0,
    notes               TEXT,
    is_archived         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_clients_name     ON clients (full_name);
CREATE INDEX idx_clients_email    ON clients (email);
CREATE INDEX idx_clients_phone    ON clients (phone);
CREATE INDEX idx_clients_city     ON clients (city);
CREATE INDEX idx_clients_archived ON clients (is_archived);

-- Family members / dependents who can be covered by the client's policies.
CREATE TABLE insured_members (
    id            INTEGER PRIMARY KEY,
    client_id     INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    full_name     TEXT    NOT NULL,
    relationship  TEXT    NOT NULL DEFAULT 'other'
                          CHECK (relationship IN ('self', 'spouse', 'son', 'daughter',
                                                  'father', 'mother', 'other')),
    date_of_birth TEXT,
    gender        TEXT    CHECK (gender IS NULL OR gender IN ('male', 'female', 'other')),
    notes         TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_members_client ON insured_members (client_id);

CREATE TABLE insurers (
    id             INTEGER PRIMARY KEY,
    name           TEXT    NOT NULL UNIQUE,
    short_code     TEXT,
    website        TEXT,
    claim_helpline TEXT,
    support_email  TEXT,
    notes          TEXT,
    is_active      INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
    id          INTEGER PRIMARY KEY,
    insurer_id  INTEGER NOT NULL REFERENCES insurers (id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    category    TEXT    NOT NULL
                        CHECK (category IN ('health', 'life', 'motor', 'travel', 'home',
                                            'personal_accident', 'critical_illness', 'other')),
    code        TEXT,
    notes       TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (insurer_id, name)
);

CREATE INDEX idx_products_insurer  ON products (insurer_id);
CREATE INDEX idx_products_category ON products (category);

CREATE TABLE policies (
    id                  INTEGER PRIMARY KEY,
    -- Stable across every renewal of the same underlying cover.
    chain_id            TEXT    NOT NULL,
    policy_year         INTEGER NOT NULL DEFAULT 1,
    previous_policy_id  INTEGER REFERENCES policies (id) ON DELETE SET NULL,
    policy_number       TEXT    NOT NULL,
    client_id           INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    insurer_id          INTEGER NOT NULL REFERENCES insurers (id),
    product_id          INTEGER REFERENCES products (id) ON DELETE SET NULL,
    category            TEXT    NOT NULL
                                CHECK (category IN ('health', 'life', 'motor', 'travel', 'home',
                                                    'personal_accident', 'critical_illness', 'other')),
    status              TEXT    NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'expired', 'renewed', 'lapsed', 'cancelled')),
    start_date          TEXT    NOT NULL,
    expiry_date         TEXT    NOT NULL,
    sum_insured         REAL,
    premium_amount      REAL,
    gst_amount          REAL,
    premium_frequency   TEXT    NOT NULL DEFAULT 'annual'
                                CHECK (premium_frequency IN ('annual', 'half_yearly', 'quarterly',
                                                             'monthly', 'single')),
    payment_mode        TEXT,
    next_due_date       TEXT,
    commission_rate     REAL,
    commission_expected REAL,
    nominee_name        TEXT,
    nominee_relation    TEXT,
    vehicle_number      TEXT,
    notes               TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (insurer_id, policy_number)
);

CREATE INDEX idx_policies_client   ON policies (client_id);
CREATE INDEX idx_policies_expiry   ON policies (expiry_date);
CREATE INDEX idx_policies_status   ON policies (status);
CREATE INDEX idx_policies_chain    ON policies (chain_id);
CREATE INDEX idx_policies_category ON policies (category);
CREATE INDEX idx_policies_insurer  ON policies (insurer_id);
CREATE INDEX idx_policies_prev     ON policies (previous_policy_id);

CREATE TABLE policy_members (
    policy_id INTEGER NOT NULL REFERENCES policies (id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES insured_members (id) ON DELETE CASCADE,
    PRIMARY KEY (policy_id, member_id)
);

CREATE TABLE premium_payments (
    id             INTEGER PRIMARY KEY,
    policy_id      INTEGER NOT NULL REFERENCES policies (id) ON DELETE CASCADE,
    installment_no INTEGER NOT NULL DEFAULT 1,
    due_date       TEXT    NOT NULL,
    amount         REAL    NOT NULL,
    paid_date      TEXT,
    paid_amount    REAL,
    mode           TEXT,
    reference      TEXT,
    status         TEXT    NOT NULL DEFAULT 'due'
                           CHECK (status IN ('due', 'paid', 'overdue', 'waived', 'bounced')),
    notes          TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (policy_id, installment_no)
);

CREATE INDEX idx_payments_policy ON premium_payments (policy_id);
CREATE INDEX idx_payments_due    ON premium_payments (due_date);

CREATE TABLE commissions (
    id              INTEGER PRIMARY KEY,
    policy_id       INTEGER NOT NULL REFERENCES policies (id) ON DELETE CASCADE,
    expected_amount REAL,
    received_amount REAL,
    received_date   TEXT,
    status          TEXT    NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'partial', 'received', 'written_off')),
    notes           TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_commissions_policy ON commissions (policy_id);

CREATE TABLE claims (
    id              INTEGER PRIMARY KEY,
    policy_id       INTEGER NOT NULL REFERENCES policies (id) ON DELETE CASCADE,
    claim_number    TEXT,
    intimation_date TEXT    NOT NULL,
    claim_type      TEXT,
    claimed_amount  REAL,
    approved_amount REAL,
    settled_date    TEXT,
    status          TEXT    NOT NULL DEFAULT 'intimated'
                            CHECK (status IN ('intimated', 'documents_pending', 'under_review',
                                              'approved', 'settled', 'rejected', 'withdrawn')),
    remarks         TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_claims_policy ON claims (policy_id);

CREATE TABLE documents (
    id          INTEGER PRIMARY KEY,
    entity_type TEXT    NOT NULL CHECK (entity_type IN ('client', 'policy', 'member', 'claim')),
    entity_id   INTEGER NOT NULL,
    title       TEXT    NOT NULL,
    file_name   TEXT    NOT NULL,
    stored_name TEXT    NOT NULL UNIQUE,
    mime_type   TEXT,
    size_bytes  INTEGER,
    sha256      TEXT,
    uploaded_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_documents_entity ON documents (entity_type, entity_id);

CREATE TABLE email_templates (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL UNIQUE,
    trigger     TEXT    NOT NULL DEFAULT 'custom'
                        CHECK (trigger IN ('expiry_reminder', 'post_expiry', 'welcome',
                                           'renewal_confirmation', 'annual_summary',
                                           'provider_digest', 'custom')),
    subject     TEXT    NOT NULL,
    body_html   TEXT    NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- offset_days is counted from expiry: positive = before expiry, negative = after.
CREATE TABLE reminder_rules (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL,
    offset_days  INTEGER NOT NULL,
    category     TEXT    CHECK (category IS NULL OR
                                category IN ('health', 'life', 'motor', 'travel', 'home',
                                             'personal_accident', 'critical_illness', 'other')),
    audience     TEXT    NOT NULL DEFAULT 'client'
                         CHECK (audience IN ('client', 'provider')),
    channel      TEXT    NOT NULL DEFAULT 'email'
                         CHECK (channel IN ('email', 'desktop', 'both')),
    template_id  INTEGER REFERENCES email_templates (id) ON DELETE SET NULL,
    is_active    INTEGER NOT NULL DEFAULT 1,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (name)
);

-- Outbox. A row is written before anything is sent, and the unique key below is
-- what makes a reminder fire exactly once per policy year no matter how many
-- times the scheduler sweeps or the app restarts.
CREATE TABLE notification_log (
    id            INTEGER PRIMARY KEY,
    rule_id       INTEGER REFERENCES reminder_rules (id) ON DELETE SET NULL,
    policy_id     INTEGER REFERENCES policies (id) ON DELETE CASCADE,
    client_id     INTEGER REFERENCES clients (id) ON DELETE CASCADE,
    policy_period TEXT    NOT NULL,
    audience      TEXT    NOT NULL DEFAULT 'client',
    channel       TEXT    NOT NULL DEFAULT 'email',
    to_address    TEXT,
    subject       TEXT,
    body_snapshot TEXT,
    status        TEXT    NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'sent', 'failed', 'skipped', 'cancelled')),
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    scheduled_for TEXT    NOT NULL,
    sent_at       TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (rule_id, policy_id, policy_period)
);

CREATE INDEX idx_notif_status    ON notification_log (status);
CREATE INDEX idx_notif_scheduled ON notification_log (scheduled_for);
CREATE INDEX idx_notif_policy    ON notification_log (policy_id);

CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY,
    at          TEXT    NOT NULL DEFAULT (datetime('now')),
    user_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
    action      TEXT    NOT NULL,
    entity_type TEXT    NOT NULL,
    entity_id   INTEGER,
    summary     TEXT,
    before_json TEXT,
    after_json  TEXT
);

CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_at     ON audit_log (at);

CREATE TABLE import_batches (
    id            INTEGER PRIMARY KEY,
    file_name     TEXT    NOT NULL,
    source_type   TEXT    NOT NULL DEFAULT 'xlsx',
    target        TEXT    NOT NULL DEFAULT 'policies',
    status        TEXT    NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running', 'completed', 'failed', 'rolled_back')),
    total_rows    INTEGER NOT NULL DEFAULT 0,
    inserted      INTEGER NOT NULL DEFAULT 0,
    updated       INTEGER NOT NULL DEFAULT 0,
    skipped       INTEGER NOT NULL DEFAULT 0,
    failed        INTEGER NOT NULL DEFAULT 0,
    mapping_json  TEXT,
    started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    finished_at   TEXT
);

CREATE TABLE import_errors (
    id          INTEGER PRIMARY KEY,
    batch_id    INTEGER NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
    row_number  INTEGER NOT NULL,
    column_name TEXT,
    value       TEXT,
    message     TEXT    NOT NULL
);

CREATE INDEX idx_import_errors_batch ON import_errors (batch_id);

CREATE TABLE saved_views (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    entity      TEXT    NOT NULL CHECK (entity IN ('clients', 'policies')),
    filter_json TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (entity, name)
);

-- Full text search over the client book, kept in sync by triggers.
CREATE VIRTUAL TABLE clients_fts USING fts5 (
    full_name, email, phone, client_code, pan,
    content = 'clients',
    content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER clients_fts_ai AFTER INSERT ON clients BEGIN
    INSERT INTO clients_fts (rowid, full_name, email, phone, client_code, pan)
    VALUES (new.id, new.full_name, new.email, new.phone, new.client_code, new.pan);
END;

CREATE TRIGGER clients_fts_ad AFTER DELETE ON clients BEGIN
    INSERT INTO clients_fts (clients_fts, rowid, full_name, email, phone, client_code, pan)
    VALUES ('delete', old.id, old.full_name, old.email, old.phone, old.client_code, old.pan);
END;

CREATE TRIGGER clients_fts_au AFTER UPDATE ON clients BEGIN
    INSERT INTO clients_fts (clients_fts, rowid, full_name, email, phone, client_code, pan)
    VALUES ('delete', old.id, old.full_name, old.email, old.phone, old.client_code, old.pan);
    INSERT INTO clients_fts (rowid, full_name, email, phone, client_code, pan)
    VALUES (new.id, new.full_name, new.email, new.phone, new.client_code, new.pan);
END;

CREATE TRIGGER clients_touch AFTER UPDATE ON clients BEGIN
    UPDATE clients SET updated_at = datetime('now') WHERE id = new.id;
END;

CREATE TRIGGER policies_touch AFTER UPDATE ON policies BEGIN
    UPDATE policies SET updated_at = datetime('now') WHERE id = new.id;
END;

-- One row per policy with everything the grids and reports need, including a
-- live days-to-expiry and whether a renewal already exists further down the chain.
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
