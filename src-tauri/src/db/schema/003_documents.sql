-- Stored documents, held as blobs inside the encrypted database.
--
-- Design note: file bytes live in the database rather than beside it. The book is
-- one SQLCipher file, so a scan kept next to it would be the one part of a
-- client's record sitting in plain sight, and the one part a backup -- a single
-- VACUUM INTO of this file -- would silently leave behind.
--
-- The bytes are split into their own table because SQLite packs the start of a
-- blob into the row's own page. Keeping them apart lets a listing read titles and
-- sizes without paging through megabytes of scan.
--
-- The 001 table was scaffolding for the opposite decision -- files on disk, named
-- by stored_name, addressed polymorphically -- and no screen ever wrote to it.

DROP TABLE IF EXISTS documents;

CREATE TABLE documents (
    id          INTEGER PRIMARY KEY,
    client_id   INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    policy_id   INTEGER REFERENCES policies (id) ON DELETE SET NULL,
    title       TEXT    NOT NULL,
    file_name   TEXT    NOT NULL,
    mime_type   TEXT    NOT NULL,
    size_bytes  INTEGER NOT NULL,
    sha256      TEXT    NOT NULL,
    uploaded_at TEXT    NOT NULL DEFAULT (datetime('now')),
    -- The same file attached twice to one client is a mis-click, not a second
    -- document. Across clients it is a shared form, and stays allowed.
    UNIQUE (client_id, sha256)
);

CREATE INDEX idx_documents_client ON documents (client_id);
CREATE INDEX idx_documents_policy ON documents (policy_id);

CREATE TABLE document_contents (
    document_id INTEGER PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
    content     BLOB NOT NULL
);
