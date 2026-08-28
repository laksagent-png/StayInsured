//! Exercises the data layer without a window: schema, renewal chains, status
//! transitions, spreadsheet import and export.

use std::path::PathBuf;
use std::sync::Mutex;

use crate::db::Database;
use crate::exporter;
use crate::importer::{self, ImportOptions};
use crate::mail::{self, Outgoing};
use crate::models::{
    ClientFilter, ClientInput, DocumentInput, EmailTemplateInput, InsurerInput, NotificationFilter,
    PolicyFilter, PolicyInput, ProductInput, RelationInput, ReminderRuleInput, RenewalInput,
};
use crate::query;
use crate::reminders::{self, NoAlerts, SweepOptions};
use crate::repo::{
    clients, dashboard, documents, insurers, notifications, policies, products, relations, rules,
    settings, templates,
};
use crate::templating;
use crate::util;
use crate::vault::{self, Vault};

struct TempDb {
    db: Database,
    dir: PathBuf,
}

impl TempDb {
    fn new(label: &str) -> Self {
        let dir =
            std::env::temp_dir().join(format!("stayinsured-test-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let vault = Vault::create();
        let key = vault.derive_key("correct horse battery").unwrap();
        let db = Database::open(&dir.join("test.db"), &key).unwrap();
        Self { db, dir }
    }
}

impl Drop for TempDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn sample_client(name: &str) -> ClientInput {
    ClientInput {
        full_name: name.into(),
        email: Some(format!(
            "{}@example.com",
            name.to_lowercase().replace(' ', ".")
        )),
        phone: Some("98765 43210".into()),
        city: Some("Pune".into()),
        ..Default::default()
    }
}

fn sample_policy(client_id: i64, insurer_id: i64, number: &str, expiry: &str) -> PolicyInput {
    PolicyInput {
        policy_number: number.into(),
        client_id,
        insurer_id,
        category: "health".into(),
        start_date: "2026-04-01".into(),
        expiry_date: expiry.into(),
        sum_insured: Some(1_000_000.0),
        premium_amount: Some(24_500.0),
        commission_rate: Some(15.0),
        ..Default::default()
    }
}

#[test]
fn migrations_and_seed_apply() {
    let temp = TempDb::new("migrate");
    temp.db
        .with(|conn| {
            let version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
            assert_eq!(version, crate::db::migrations::latest_version());

            let insurers: i64 =
                conn.query_row("SELECT COUNT(*) FROM insurers", [], |row| row.get(0))?;
            assert!(insurers > 20, "seed insurers should be present");

            let rules: i64 = conn.query_row(
                "SELECT COUNT(*) FROM reminder_rules WHERE is_active = 1",
                [],
                |row| row.get(0),
            )?;
            assert_eq!(rules, 5, "the 60/30/15/7/1 ladder should be active");

            assert_eq!(settings::get_or(conn, "currency", ""), "INR");
            Ok(())
        })
        .unwrap();
}

/// The 004 trigger keeps a fresh book right; this is the book that is not fresh.
/// An agency running 0.0.3 has been editing clients against the old trigger, so
/// what has to be shown is that opening the app once puts their index back in
/// agreement with their client list.
#[test]
fn a_book_edited_before_the_fix_has_its_search_index_put_right() {
    const OLD_TRIGGER: &str = "CREATE TRIGGER clients_fts_au AFTER UPDATE ON clients BEGIN \
         INSERT INTO clients_fts (clients_fts, rowid, full_name, email, phone, client_code, pan) \
         VALUES ('delete', old.id, old.full_name, old.email, old.phone, old.client_code, old.pan); \
         INSERT INTO clients_fts (rowid, full_name, email, phone, client_code, pan) \
         VALUES (new.id, new.full_name, new.email, new.phone, new.client_code, new.pan); \
         END;";

    /// The overview as it stood before 006 added the health columns to it. A
    /// book wound back has to be wound back all the way: leaving the columns on
    /// `policies` would have 006 replay against a table that already suits it,
    /// and prove nothing about the agency's book.
    const OLD_POLICY_OVERVIEW: &str = "CREATE VIEW policy_overview AS \
         SELECT p.id, p.chain_id, p.policy_year, p.previous_policy_id, p.policy_number, \
                p.client_id, c.client_code, c.full_name AS client_name, c.email AS client_email, \
                c.phone AS client_phone, c.city AS client_city, c.reminders_opted_out, \
                p.insurer_id, i.name AS insurer_name, p.product_id, pr.name AS product_name, \
                p.category, p.status, p.start_date, p.expiry_date, p.sum_insured, \
                p.premium_amount, p.gst_amount, p.premium_frequency, p.payment_mode, \
                p.next_due_date, p.commission_rate, p.commission_expected, p.nominee_name, \
                p.nominee_relation, p.vehicle_number, p.notes, p.created_at, p.updated_at, \
                CAST(julianday(p.expiry_date) - julianday(date('now', 'localtime')) AS INTEGER) \
                    AS days_to_expiry, \
                EXISTS (SELECT 1 FROM policies s WHERE s.previous_policy_id = p.id) AS is_renewed \
         FROM policies p \
         JOIN clients c ON c.id = p.client_id \
         JOIN insurers i ON i.id = p.insurer_id \
         LEFT JOIN products pr ON pr.id = p.product_id;";

    let temp = TempDb::new("damaged-index");
    let id = temp
        .db
        .with(|conn| {
            let id = clients::create(
                conn,
                &ClientInput {
                    full_name: "Rohit Bose".into(),
                    ..Default::default()
                },
            )?;

            // Wind the book back to what 0.0.3 wrote: the update trigger without
            // the WHEN clause, the version stamp that went with it, an index left
            // disagreeing with the client list the way an edit under that trigger
            // could leave it, and the member tables 005 has since replaced —
            // including a daughter, so that re-applying has a family to move.
            conn.execute_batch(&format!(
                "DROP TRIGGER clients_fts_au; \
                 UPDATE clients SET full_name = 'Rohit Kumar Sharma' WHERE id = {id}; \
                 {OLD_TRIGGER} \
                 DROP VIEW policy_overview; \
                 ALTER TABLE policies DROP COLUMN variant; \
                 ALTER TABLE policies DROP COLUMN riders; \
                 ALTER TABLE policies DROP COLUMN plan_type; \
                 ALTER TABLE policies DROP COLUMN term; \
                 ALTER TABLE policies DROP COLUMN policy_type; \
                 ALTER TABLE policies DROP COLUMN broker; \
                 ALTER TABLE policies DROP COLUMN inbuilt_rider; \
                 {OLD_POLICY_OVERVIEW} \
                 DROP TABLE policy_members; \
                 DROP TABLE client_relations; \
                 CREATE TABLE insured_members ( \
                     id            INTEGER PRIMARY KEY, \
                     client_id     INTEGER NOT NULL REFERENCES clients (id) ON DELETE CASCADE, \
                     full_name     TEXT    NOT NULL, \
                     relationship  TEXT    NOT NULL DEFAULT 'other', \
                     date_of_birth TEXT, \
                     gender        TEXT, \
                     notes         TEXT, \
                     created_at    TEXT    NOT NULL DEFAULT (datetime('now')), \
                     updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))); \
                 CREATE INDEX idx_members_client ON insured_members (client_id); \
                 CREATE TABLE policy_members ( \
                     policy_id INTEGER NOT NULL REFERENCES policies (id) ON DELETE CASCADE, \
                     member_id INTEGER NOT NULL REFERENCES insured_members (id) ON DELETE CASCADE, \
                     PRIMARY KEY (policy_id, member_id)); \
                 INSERT INTO insured_members (client_id, full_name, relationship, date_of_birth) \
                 VALUES ({id}, 'Ananya Ghosh', 'daughter', '2010-05-06'); \
                 PRAGMA user_version = 3;"
            ))?;
            Ok(id)
        })
        .unwrap();

    let found = |term: &str| -> i64 {
        temp.db
            .with(|conn| {
                Ok(clients::list(
                    conn,
                    &ClientFilter {
                        search: Some(term.into()),
                        ..Default::default()
                    },
                )?
                .total)
            })
            .unwrap()
    };

    // Read straight out of the index while the book is wound back, rather than
    // through client search: the repository is today's code and expects today's
    // schema, and what is being shown here is what the index itself holds.
    let indexed = |term: &str| -> i64 {
        temp.db
            .with(|conn| {
                Ok(conn.query_row(
                    "SELECT COUNT(*) FROM clients_fts WHERE clients_fts MATCH ?1",
                    [format!("\"{}\"*", term.to_lowercase())],
                    |row| row.get(0),
                )?)
            })
            .unwrap()
    };

    assert_eq!(
        indexed("Sharma"),
        0,
        "the index has not heard of the new name"
    );
    assert_eq!(indexed("Bose"), 1, "and still answers to the old one");
    temp.db
        .with(|conn| {
            // Nothing reports this. FTS5's integrity-check reads the index against
            // itself, so a book in this state looks well, which is the reason 004
            // rebuilds every book rather than trying to find the bad ones.
            conn.execute_batch("INSERT INTO clients_fts(clients_fts) VALUES('integrity-check')")?;

            // And the fault itself: filling in a field the book holds nowhere.
            let refused = clients::update(
                conn,
                id,
                &ClientInput {
                    full_name: "Rohit Kumar Sharma".into(),
                    pan: Some("abcde1234f".into()),
                    ..Default::default()
                },
            );
            assert!(
                matches!(refused, Err(crate::error::AppError::Db(_))),
                "the old trigger refuses this edit, which is what 0.0.3 does to an agency"
            );
            Ok(())
        })
        .unwrap();

    temp.db.with_tx(crate::db::migrations::apply).unwrap();

    temp.db
        .with(|conn| {
            let version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
            assert_eq!(version, crate::db::migrations::latest_version());

            clients::update(
                conn,
                id,
                &ClientInput {
                    full_name: "Rohit Kumar Verma".into(),
                    email: Some("rohit@example.com".into()),
                    pan: Some("abcde1234f".into()),
                    ..Default::default()
                },
            )?;
            conn.execute_batch("INSERT INTO clients_fts(clients_fts) VALUES('integrity-check')")?;

            // The same upgrade moved the daughter out of the member table and into
            // the book as a client of her own, related to her father.
            let family = relations::list_for_client(conn, id)?;
            assert_eq!(family.len(), 1);
            assert_eq!(family[0].full_name, "Ananya Ghosh");
            assert_eq!(family[0].relationship, "daughter");
            assert_eq!(
                family[0].date_of_birth.as_deref(),
                Some("2010-05-06"),
                "what the member row knew came with her"
            );
            assert!(
                family[0].client_code.starts_with("CL-"),
                "and she was allocated a code like any other client"
            );
            Ok(())
        })
        .unwrap();

    assert_eq!(found("Verma"), 1, "the edit the book used to refuse");
    assert_eq!(
        found("Ananya"),
        1,
        "a promoted daughter is searchable, because she is a client"
    );
    assert_eq!(found("ABCDE1234F"), 1);
    assert_eq!(
        found("Bose"),
        0,
        "and the name the index was stuck on is gone with the rebuild"
    );
    assert_eq!(found("Sharma"), 0);
}

#[test]
fn wrong_password_is_rejected() {
    let dir = std::env::temp_dir().join(format!("stayinsured-key-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("test.db");

    let vault = Vault::create();
    let good = vault.derive_key("the right one").unwrap();
    let bad = vault.derive_key("the wrong one").unwrap();
    assert_ne!(good, bad);

    Database::open(&path, &good).unwrap();
    let reopened = Database::open(&path, &bad);
    assert!(
        matches!(reopened, Err(crate::error::AppError::BadPassword)),
        "opening with the wrong key must report a bad password"
    );

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn the_vault_carries_the_cost_of_turning_a_password_into_a_key() {
    let temp = TempDb::new("vault");
    let vault = Vault::create();

    assert_eq!(vault.version, 1);
    assert_eq!(
        (vault.m_cost, vault.t_cost, vault.p_cost),
        (65_536, 3, 1),
        "roughly 64 MiB over three passes, which is what the design promises"
    );
    assert_eq!(vault.salt_hex.len(), 32, "sixteen bytes of salt");

    let key = vault.derive_key("correct horse battery").unwrap();
    assert_eq!(key.len(), 64, "a 32-byte key written as hex");
    assert_eq!(
        vault.derive_key("correct horse battery").unwrap(),
        key,
        "the same password and vault must reach the same key, or nothing opens"
    );

    // The salt is what stops two books sharing a password sharing a key.
    let elsewhere = Vault::create();
    assert_ne!(elsewhere.salt_hex, vault.salt_hex);
    assert_ne!(elsewhere.derive_key("correct horse battery").unwrap(), key);

    // It sits beside the database in clear text, so it must hold no secret.
    let path = temp.dir.join("vault.json");
    vault.save(&path).unwrap();
    assert!(Vault::exists(&path));
    let raw = std::fs::read_to_string(&path).unwrap();
    assert!(!raw.contains("correct horse battery"));
    assert!(!raw.contains(&key));
    assert_eq!(
        Vault::load(&path)
            .unwrap()
            .derive_key("correct horse battery")
            .unwrap(),
        key,
        "reloading the parameters reaches the same key"
    );
}

#[test]
fn changing_the_password_leaves_the_book_readable() {
    let temp = TempDb::new("rekey");
    let path = temp.dir.join("rekeyed.db");

    let first = Vault::create();
    let old_key = first.derive_key("the first one").unwrap();
    let db = Database::open(&path, &old_key).unwrap();
    db.with(|conn| {
        clients::create(conn, &sample_client("Ravi Menon"))?;
        Ok(())
    })
    .unwrap();

    let second = Vault::create();
    let new_key = second.derive_key("the second one").unwrap();
    db.rekey(&new_key).unwrap();
    drop(db);

    assert!(
        matches!(
            Database::open(&path, &old_key),
            Err(crate::error::AppError::BadPassword)
        ),
        "the old password stops working the moment it is changed"
    );

    let reopened = Database::open(&path, &new_key).unwrap();
    reopened
        .with(|conn| {
            let book = clients::list(conn, &ClientFilter::default())?;
            assert_eq!(book.total, 1, "and the book is still there behind it");
            assert_eq!(book.rows[0].full_name, "Ravi Menon");
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_password_is_checked_without_being_kept() {
    let phc = vault::hash_password("open sesame").unwrap();

    assert!(phc.starts_with("$argon2"));
    assert!(
        !phc.contains("open sesame"),
        "the password itself is never written down"
    );
    assert!(vault::verify_password("open sesame", &phc));
    assert!(!vault::verify_password("Open Sesame", &phc));
    assert!(!vault::verify_password("", &phc));

    assert_ne!(
        vault::hash_password("open sesame").unwrap(),
        phc,
        "two people choosing one password do not look alike in the table"
    );
    assert!(
        !vault::verify_password("open sesame", "not a hash at all"),
        "a damaged hash is a failed check rather than a way in"
    );
}

#[test]
fn hex_survives_the_round_trip_and_refuses_nonsense() {
    assert_eq!(vault::to_hex(&[0x00, 0x0f, 0xff]), "000fff");
    assert_eq!(vault::from_hex("000fff").unwrap(), vec![0x00, 0x0f, 0xff]);
    assert_eq!(vault::from_hex("").unwrap(), Vec::<u8>::new());

    assert!(matches!(
        vault::from_hex("zz"),
        Err(crate::error::AppError::Other(_))
    ));
    assert!(
        matches!(
            vault::from_hex("abc"),
            Err(crate::error::AppError::Other(_))
        ),
        "an odd number of digits is not a run of bytes"
    );
}

#[test]
fn a_setting_falls_back_when_it_is_missing_or_left_blank() {
    let temp = TempDb::new("settings");
    temp.db
        .with(|conn| {
            assert_eq!(settings::get(conn, "nothing_here")?, None);
            assert_eq!(
                settings::get_or(conn, "nothing_here", "fallback"),
                "fallback"
            );

            settings::put(conn, "provider_name", "Sunrise Insurance")?;
            assert_eq!(
                settings::get_or(conn, "provider_name", "fallback"),
                "Sunrise Insurance"
            );

            // Clearing the box in Settings writes an empty string, which has to
            // mean "use the default" rather than "send an empty name".
            settings::put(conn, "provider_name", "")?;
            assert_eq!(
                settings::get_or(conn, "provider_name", "Sunrise"),
                "Sunrise"
            );
            assert_eq!(
                settings::get(conn, "provider_name")?,
                Some(String::new()),
                "though what was written is still what is stored"
            );

            assert_eq!(
                settings::get_i64(conn, "daily_send_cap", 200),
                400,
                "the seeded cap answers, not the fallback"
            );
            assert_eq!(
                settings::get_i64(conn, "no_such_number", 7),
                7,
                "a key nobody has set does fall back"
            );
            settings::put(conn, "daily_send_cap", "40")?;
            assert_eq!(settings::get_i64(conn, "daily_send_cap", 200), 40);
            settings::put(conn, "daily_send_cap", "as many as it takes")?;
            assert_eq!(
                settings::get_i64(conn, "daily_send_cap", 200),
                200,
                "a number that is not one falls back instead of failing the sweep"
            );

            // Saving the Settings screen writes the lot in one go, over whatever
            // was there before.
            let mut batch = std::collections::HashMap::new();
            batch.insert("currency".to_string(), "USD".to_string());
            batch.insert("date_format".to_string(), "dd MMM yyyy".to_string());
            settings::put_many(conn, &batch)?;

            let everything = settings::all(conn)?;
            assert_eq!(everything.get("currency").map(String::as_str), Some("USD"));
            assert_eq!(
                everything.get("date_format").map(String::as_str),
                Some("dd MMM yyyy")
            );
            assert!(
                everything.len() > 2,
                "the seeded defaults are still alongside them"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn client_codes_increment_and_dedupe_matching() {
    let temp = TempDb::new("clients");
    temp.db
        .with(|conn| {
            let first = clients::create(conn, &sample_client("Rohit Sharma"))?;
            let second = clients::create(conn, &sample_client("Anita Desai"))?;

            let codes: Vec<String> = [first, second]
                .iter()
                .map(|id| clients::get(conn, *id).unwrap().client_code)
                .collect();
            assert_eq!(codes, vec!["CL-00001", "CL-00002"]);

            // The importer relies on this order: code, then email, then phone, then name.
            let by_email = clients::find_match(
                conn,
                None,
                Some("rohit.sharma@example.com"),
                None,
                "Someone Else",
            )?;
            assert_eq!(by_email, Some(first));
            let by_name = clients::find_match(conn, None, None, None, "anita desai")?;
            assert_eq!(by_name, Some(second));
            assert_eq!(clients::find_match(conn, None, None, None, "Nobody")?, None);

            let page = clients::list(
                conn,
                &ClientFilter {
                    search: Some("rohit".into()),
                    ..Default::default()
                },
            )?;
            assert_eq!(page.total, 1);
            assert_eq!(page.rows[0].full_name, "Rohit Sharma");
            Ok(())
        })
        .unwrap();
}

#[test]
fn matching_prefers_the_code_then_the_email_then_the_phone() {
    let temp = TempDb::new("matching");
    temp.db
        .with(|conn| {
            // Each client answers to exactly one of the four, so whichever comes
            // back names the step of the order that decided it.
            let by_code = clients::create(
                conn,
                &ClientInput {
                    client_code: Some("CL-09000".into()),
                    phone: Some("90000 00001".into()),
                    ..sample_client("Asha Pillai")
                },
            )?;
            let by_email = clients::create(
                conn,
                &ClientInput {
                    phone: Some("90000 00002".into()),
                    ..sample_client("Bharat Rao")
                },
            )?;
            let by_phone = clients::create(
                conn,
                &ClientInput {
                    email: None,
                    phone: Some("+91 90000 00003".into()),
                    ..sample_client("Chitra Sen")
                },
            )?;
            let by_name = clients::create(
                conn,
                &ClientInput {
                    email: None,
                    phone: None,
                    ..sample_client("Zara Khan")
                },
            )?;

            assert_eq!(
                clients::find_match(
                    conn,
                    Some("CL-09000"),
                    Some("bharat.rao@example.com"),
                    Some("+919000000003"),
                    "Zara Khan",
                )?,
                Some(by_code)
            );
            assert_eq!(
                clients::find_match(
                    conn,
                    None,
                    Some("bharat.rao@example.com"),
                    Some("+919000000003"),
                    "Zara Khan",
                )?,
                Some(by_email)
            );
            assert_eq!(
                clients::find_match(conn, None, None, Some("+919000000003"), "Zara Khan")?,
                Some(by_phone)
            );
            assert_eq!(
                clients::find_match(conn, None, None, None, "zara khan")?,
                Some(by_name)
            );

            // A code the book has never seen falls through to the next step
            // rather than deciding there is no such client.
            assert_eq!(
                clients::find_match(
                    conn,
                    Some("CL-99999"),
                    Some("BHARAT.RAO@EXAMPLE.COM"),
                    None,
                    "Nobody At All",
                )?,
                Some(by_email),
                "an unknown code keeps looking, and email ignores case"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn archiving_puts_a_client_away_without_losing_them() {
    let temp = TempDb::new("archive");
    temp.db
        .with(|conn| {
            let id = clients::create(conn, &sample_client("Meera Iyer"))?;
            let insurer = insurers::find_or_create(conn, "Star Health")?;
            policies::create(
                conn,
                &sample_policy(id, insurer, "SH/2026/55", "2027-03-31"),
            )?;

            clients::set_archived(conn, id, true)?;
            assert_eq!(
                clients::list(conn, &ClientFilter::default())?.total,
                0,
                "the everyday list leaves archived clients out"
            );

            let including = clients::list(
                conn,
                &ClientFilter {
                    include_archived: Some(true),
                    ..Default::default()
                },
            )?;
            assert_eq!(including.total, 1);
            assert!(including.rows[0].is_archived);

            // Archiving is the gentler option offered next to delete, so the
            // client and their policies have to survive it intact.
            assert_eq!(clients::get(conn, id)?.full_name, "Meera Iyer");
            let kept: i64 =
                conn.query_row("SELECT COUNT(*) FROM policies", [], |row| row.get(0))?;
            assert_eq!(kept, 1);

            clients::set_archived(conn, id, false)?;
            assert_eq!(clients::list(conn, &ClientFilter::default())?.total, 1);

            assert!(
                matches!(
                    clients::set_archived(conn, 9_999, true),
                    Err(crate::error::AppError::NotFound("Client"))
                ),
                "archiving a client who is not there is an error, not a silent pass"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn deleting_a_client_takes_their_policies_but_leaves_their_family_standing() {
    let temp = TempDb::new("client-cascade");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Neha Kulkarni"))?;
            let insurer = insurers::find_or_create(conn, "Star Health")?;
            let policy = policies::create(
                conn,
                &sample_policy(client, insurer, "SH/2026/77", "2027-03-31"),
            )?;
            let son = clients::create(conn, &sample_client("Aarav Kulkarni"))?;
            relations::link(
                conn,
                &RelationInput {
                    client_id: client,
                    related_client_id: son,
                    relationship: "son".into(),
                },
            )?;
            policies::set_members(conn, policy, &[client, son])?;

            // A second client proves the delete reaches for one book, not the table.
            let bystander = clients::create(conn, &sample_client("Sanjay Gupta"))?;
            policies::create(
                conn,
                &sample_policy(bystander, insurer, "SH/2026/78", "2027-03-31"),
            )?;

            clients::delete(conn, client)?;

            let policies_left: i64 = conn.query_row(
                "SELECT COUNT(*) FROM policies WHERE client_id = ?1",
                [client],
                |row| row.get(0),
            )?;
            let edges_left: i64 =
                conn.query_row("SELECT COUNT(*) FROM client_relations", [], |row| {
                    row.get(0)
                })?;
            let links_left: i64 =
                conn.query_row("SELECT COUNT(*) FROM policy_members", [], |row| row.get(0))?;
            assert_eq!(
                (policies_left, edges_left, links_left),
                (0, 0, 0),
                "the policies, the relationship and the cover rows all go"
            );

            // The son is a client, not a detail of his mother's record. Losing him
            // with her is what the old member table did, and what a book that has
            // his own motor policy next year cannot afford to do.
            assert_eq!(
                clients::get(conn, son)?.full_name,
                "Aarav Kulkarni",
                "the family stay in the book when the client they were listed under goes"
            );

            let survivors: i64 =
                conn.query_row("SELECT COUNT(*) FROM policies", [], |row| row.get(0))?;
            assert_eq!(survivors, 1, "the other client keeps their policy");
            assert!(matches!(
                clients::get(conn, client),
                Err(crate::error::AppError::NotFound("Client"))
            ));
            Ok(())
        })
        .unwrap();
}

#[test]
fn deleting_a_family_reaches_one_step_and_stops() {
    let temp = TempDb::new("family-delete");
    temp.db
        .with(|conn| {
            let holder = clients::create(conn, &sample_client("Rajesh Kumar"))?;
            let wife = clients::create(conn, &sample_client("Priya Kumar"))?;
            let son = clients::create(conn, &sample_client("Aarav Kumar"))?;
            // One step further out: the wife's father, connected to the holder
            // only through her.
            let father_in_law = clients::create(conn, &sample_client("Suresh Rao"))?;

            for (a, b, rel) in [
                (holder, wife, "spouse"),
                (holder, son, "son"),
                (wife, father_in_law, "father"),
            ] {
                relations::link(
                    conn,
                    &RelationInput {
                        client_id: a,
                        related_client_id: b,
                        relationship: rel.into(),
                    },
                )?;
            }

            let deleted = clients::delete_with_immediate_family(conn, holder)?;
            assert_eq!(deleted.len(), 3, "the holder, the wife and the son");

            // The whole family is reachable from the holder, so a walk would have
            // taken the father-in-law too. Recording an in-law must not widen what
            // a delete removes.
            assert_eq!(
                clients::get(conn, father_in_law)?.full_name,
                "Suresh Rao",
                "one step out, so an in-law reached only through the wife stays"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_family_is_the_same_walked_from_any_of_them() {
    let temp = TempDb::new("family-walk");
    temp.db
        .with(|conn| {
            let grandfather = clients::create(conn, &sample_client("Mohan Kumar"))?;
            let holder = clients::create(conn, &sample_client("Rajesh Kumar"))?;
            let wife = clients::create(conn, &sample_client("Priya Kumar"))?;
            let son = clients::create(conn, &sample_client("Aarav Kumar"))?;
            let unrelated = clients::create(conn, &sample_client("Nobody Here"))?;

            for (a, b, rel) in [
                (grandfather, holder, "son"),
                (holder, wife, "spouse"),
                (holder, son, "son"),
            ] {
                relations::link(
                    conn,
                    &RelationInput {
                        client_id: a,
                        related_client_id: b,
                        relationship: rel.into(),
                    },
                )?;
            }

            // Three generations, entered from the middle and from the bottom. The
            // old member table could not answer the second question at all: a
            // grandfather was not reachable from a son.
            let from_holder = relations::family(conn, holder)?;
            let from_son = relations::family(conn, son)?;

            let mut ids_from_holder: Vec<i64> =
                from_holder.members.iter().map(|m| m.client_id).collect();
            let mut ids_from_son: Vec<i64> = from_son.members.iter().map(|m| m.client_id).collect();
            ids_from_holder.sort();
            ids_from_son.sort();

            assert_eq!(
                ids_from_holder, ids_from_son,
                "the same four people whichever end the walk starts from"
            );
            assert_eq!(ids_from_holder.len(), 4);
            assert!(
                !ids_from_holder.contains(&unrelated),
                "a client with no edge to the family is not in it"
            );

            let grandfather_steps = from_son
                .members
                .iter()
                .find(|m| m.client_id == grandfather)
                .map(|m| m.steps);
            assert_eq!(
                grandfather_steps,
                Some(2),
                "two edges from the son, and the tree says so"
            );
            assert_eq!(from_son.edges.len(), 3, "every edge among the people found");
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_relationship_is_one_edge_however_many_times_it_is_recorded() {
    let temp = TempDb::new("family-edges");
    temp.db
        .with(|conn| {
            let father = clients::create(conn, &sample_client("Rajesh Kumar"))?;
            let son = clients::create(conn, &sample_client("Aarav Kumar"))?;

            relations::link(
                conn,
                &RelationInput {
                    client_id: father,
                    related_client_id: son,
                    relationship: "son".into(),
                },
            )?;
            // The same fact entered from the son's page, the other way round.
            relations::link(
                conn,
                &RelationInput {
                    client_id: son,
                    related_client_id: father,
                    relationship: "father".into(),
                },
            )?;

            let edges: i64 =
                conn.query_row("SELECT COUNT(*) FROM client_relations", [], |row| {
                    row.get(0)
                })?;
            assert_eq!(edges, 1, "one pair, one edge, whichever page recorded it");

            let seen = relations::list_for_client(conn, son)?;
            assert_eq!(seen.len(), 1);
            assert_eq!(seen[0].relationship, "father");
            assert!(
                seen[0].outgoing,
                "the last word entered is the one stored, in the direction it was said"
            );

            // Read from the other side, the same edge is the same word, not its
            // opposite: "father of", which needs no gender to say.
            let from_father = relations::list_for_client(conn, father)?;
            assert_eq!(from_father[0].relationship, "father");
            assert!(!from_father[0].outgoing);

            relations::unlink(conn, father, son)?;
            assert!(
                relations::list_for_client(conn, father)?.is_empty(),
                "unlinking works whichever way round the edge is stored"
            );
            assert_eq!(
                clients::get(conn, son)?.full_name,
                "Aarav Kumar",
                "and it takes the edge, not the person"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn nobody_can_be_their_own_ancestor() {
    let temp = TempDb::new("family-loop");
    temp.db
        .with(|conn| {
            let grandfather = clients::create(conn, &sample_client("Mohan Kumar"))?;
            let father = clients::create(conn, &sample_client("Rajesh Kumar"))?;
            let son = clients::create(conn, &sample_client("Aarav Kumar"))?;

            for (a, b) in [(grandfather, father), (father, son)] {
                relations::link(
                    conn,
                    &RelationInput {
                        client_id: a,
                        related_client_id: b,
                        relationship: "son".into(),
                    },
                )?;
            }

            let closing = relations::link(
                conn,
                &RelationInput {
                    client_id: son,
                    related_client_id: grandfather,
                    relationship: "son".into(),
                },
            );
            assert!(
                matches!(closing, Err(crate::error::AppError::Validation(_))),
                "a son cannot be his own grandfather's father"
            );

            // A loop that is not ancestry is a family with two ways through it,
            // and stays allowed: cousins who marry are one family, not a fault.
            let cousin = clients::create(conn, &sample_client("Kavita Rao"))?;
            relations::link(
                conn,
                &RelationInput {
                    client_id: grandfather,
                    related_client_id: cousin,
                    relationship: "daughter".into(),
                },
            )?;
            relations::link(
                conn,
                &RelationInput {
                    client_id: son,
                    related_client_id: cousin,
                    relationship: "spouse".into(),
                },
            )?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_dependent_stops_being_one_by_holding_a_policy() {
    let temp = TempDb::new("dependents");
    temp.db
        .with(|conn| {
            let holder = clients::create(conn, &sample_client("Rajesh Kumar"))?;
            let wife = clients::create(conn, &sample_client("Priya Kumar"))?;
            let insurer = insurers::find_or_create(conn, "Niva Bupa")?;
            policies::create(conn, &sample_policy(holder, insurer, "NB-1", "2027-06-30"))?;
            relations::link(
                conn,
                &RelationInput {
                    client_id: holder,
                    related_client_id: wife,
                    relationship: "spouse".into(),
                },
            )?;

            let browsing = clients::list(conn, &ClientFilter::default())?;
            let names: Vec<&str> = browsing.rows.iter().map(|c| c.full_name.as_str()).collect();
            assert_eq!(
                names,
                vec!["Rajesh Kumar"],
                "browsing the book shows the policyholder, not the life on his floater"
            );

            // But asked for by name she is there. A book that held her and would
            // not admit it would be worse than one that never held her.
            let searched = clients::list(
                conn,
                &ClientFilter {
                    search: Some("Priya".into()),
                    ..Default::default()
                },
            )?;
            assert_eq!(searched.rows.len(), 1);
            assert!(searched.rows[0].is_dependent);
            assert_eq!(searched.rows[0].relatives, 1);

            let with_family = clients::list(
                conn,
                &ClientFilter {
                    include_family: Some(true),
                    ..Default::default()
                },
            )?;
            assert_eq!(with_family.total, 2, "the toggle brings her into the list");

            // Her own term plan makes her a policyholder, and nothing had to be
            // corrected for that to be true.
            policies::create(conn, &sample_policy(wife, insurer, "NB-2", "2027-09-30"))?;
            let after = clients::list(conn, &ClientFilter::default())?;
            assert_eq!(
                after.total, 2,
                "a dependent who buys cover appears without being reclassified"
            );
            assert!(!clients::get(conn, wife)?.is_dependent);
            Ok(())
        })
        .unwrap();
}

#[test]
fn the_dashboard_counts_policyholders_not_people() {
    let temp = TempDb::new("dashboard-holders");
    temp.db
        .with(|conn| {
            let holder = clients::create(conn, &sample_client("Rajesh Kumar"))?;
            let insurer = insurers::find_or_create(conn, "Niva Bupa")?;
            policies::create(conn, &sample_policy(holder, insurer, "NB-1", "2027-06-30"))?;

            let before = dashboard::load(conn)?;

            // A wife and a son on his floater. Both are clients, neither has an
            // email address, and neither is somebody the agency is failing to
            // reach — so the one figure on this screen meant to be acted on must
            // not move.
            for (name, relationship) in [("Priya Kumar", "spouse"), ("Aarav Kumar", "son")] {
                let relative = clients::create(
                    conn,
                    &ClientInput {
                        full_name: name.into(),
                        ..Default::default()
                    },
                )?;
                relations::link(
                    conn,
                    &RelationInput {
                        client_id: holder,
                        related_client_id: relative,
                        relationship: relationship.into(),
                    },
                )?;
            }

            let after = dashboard::load(conn)?;
            assert_eq!(after.total_clients, before.total_clients);
            assert_eq!(after.active_clients, before.active_clients);
            assert_eq!(after.clients_without_email, before.clients_without_email);

            // Until one of them buys cover of her own.
            let wife: i64 = conn.query_row(
                "SELECT id FROM clients WHERE full_name = 'Priya Kumar'",
                [],
                |row| row.get(0),
            )?;
            policies::create(conn, &sample_policy(wife, insurer, "NB-2", "2027-09-30"))?;

            let counted = dashboard::load(conn)?;
            assert_eq!(counted.total_clients, before.total_clients + 1);
            assert_eq!(
                counted.clients_without_email,
                before.clients_without_email + 1,
                "a policyholder with no email address is worth chasing"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn archiving_a_family_moves_the_household_and_stops() {
    let temp = TempDb::new("family-archive");
    temp.db
        .with(|conn| {
            let holder = clients::create(conn, &sample_client("Rajesh Kumar"))?;
            let wife = clients::create(conn, &sample_client("Priya Kumar"))?;
            let father_in_law = clients::create(conn, &sample_client("Suresh Rao"))?;
            relations::link(
                conn,
                &RelationInput {
                    client_id: holder,
                    related_client_id: wife,
                    relationship: "spouse".into(),
                },
            )?;
            relations::link(
                conn,
                &RelationInput {
                    client_id: wife,
                    related_client_id: father_in_law,
                    relationship: "father".into(),
                },
            )?;

            let moved = clients::set_family_archived(conn, holder, true)?;
            assert_eq!(moved, 2, "the holder and his wife");
            assert!(clients::get(conn, holder)?.is_archived);
            assert!(clients::get(conn, wife)?.is_archived);
            assert!(
                !clients::get(conn, father_in_law)?.is_archived,
                "one step out, so the in-law is left where he is"
            );

            let back = clients::set_family_archived(conn, holder, false)?;
            assert_eq!(back, 2, "and it reverses");
            assert!(!clients::get(conn, holder)?.is_archived);
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_client_code_belongs_to_one_client() {
    let temp = TempDb::new("client-codes");
    temp.db
        .with(|conn| {
            let first = clients::create(
                conn,
                &ClientInput {
                    client_code: Some("CL-00042".into()),
                    ..sample_client("Priya Menon")
                },
            )?;

            let clash = clients::create(
                conn,
                &ClientInput {
                    client_code: Some("CL-00042".into()),
                    ..sample_client("Priya Nair")
                },
            );
            assert!(
                matches!(clash, Err(crate::error::AppError::Conflict(_))),
                "a code already in use is refused rather than silently duplicated"
            );

            // The counter reads the highest code in the book, so one typed by
            // hand moves the automatic ones past it instead of colliding.
            let next = clients::create(conn, &sample_client("Vikas Rao"))?;
            assert_eq!(clients::get(conn, next)?.client_code, "CL-00043");

            // Editing a client without restating the code keeps it.
            clients::update(
                conn,
                first,
                &ClientInput {
                    client_code: None,
                    ..sample_client("Priya Menon Iyer")
                },
            )?;
            let saved = clients::get(conn, first)?;
            assert_eq!(saved.client_code, "CL-00042");
            assert_eq!(saved.full_name, "Priya Menon Iyer");
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_blank_field_is_stored_as_nothing_rather_than_as_empty_text() {
    let temp = TempDb::new("blanks");
    temp.db
        .with(|conn| {
            let id = clients::create(
                conn,
                &ClientInput {
                    full_name: "  ramesh IYER ".into(),
                    email: Some("   ".into()),
                    phone: Some("".into()),
                    city: Some("  Nashik  ".into()),
                    pan: Some("abcde1234f".into()),
                    notes: Some("\n\t".into()),
                    ..Default::default()
                },
            )?;

            let saved = clients::get(conn, id)?;
            assert_eq!(saved.email, None, "an untouched box is not an empty string");
            assert_eq!(saved.phone, None);
            assert_eq!(saved.notes, None);
            assert_eq!(
                saved.city.as_deref(),
                Some("Nashik"),
                "space is trimmed off"
            );
            assert_eq!(
                saved.pan.as_deref(),
                Some("ABCDE1234F"),
                "tax identifiers are stored upper case"
            );
            assert_eq!(
                saved.full_name, "Ramesh Iyer",
                "names are tidied on the way in"
            );

            // The screen that finds clients with no address to write to depends
            // on blank and missing being the same thing.
            let missing = clients::list(
                conn,
                &ClientFilter {
                    missing_email: Some(true),
                    ..Default::default()
                },
            )?;
            assert_eq!(missing.total, 1);
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_client_renamed_or_filled_in_is_still_the_one_the_search_finds() {
    let temp = TempDb::new("client-edit-search");
    temp.db
        .with(|conn| {
            // A book of one client, with no email and no pan anywhere in it, is
            // the shape 004 was written for. FTS5 counts words a column at a time
            // across the whole table, and until that migration an edit asked it to
            // take the saved row's words away twice, which a column holding none
            // cannot survive.
            let id = clients::create(
                conn,
                &ClientInput {
                    full_name: "Rohit Bose".into(),
                    ..Default::default()
                },
            )?;

            clients::update(
                conn,
                id,
                &ClientInput {
                    full_name: "Rohit Kumar Sharma".into(),
                    email: Some("rohit@example.com".into()),
                    phone: Some("98765 43210".into()),
                    pan: Some("abcde1234f".into()),
                    ..Default::default()
                },
            )?;

            let saved = clients::get(conn, id)?;
            assert_eq!(saved.full_name, "Rohit Kumar Sharma");
            assert_eq!(saved.email.as_deref(), Some("rohit@example.com"));
            assert_eq!(saved.pan.as_deref(), Some("ABCDE1234F"));

            let found = |term: &str| -> crate::error::AppResult<i64> {
                Ok(clients::list(
                    conn,
                    &ClientFilter {
                        search: Some(term.into()),
                        ..Default::default()
                    },
                )?
                .total)
            };
            assert_eq!(found("Sharma")?, 1, "the name they now go by finds them");
            assert_eq!(
                found("ABCDE1234F")?,
                1,
                "and so does a field just filled in"
            );
            assert_eq!(found("9876543210")?, 1);
            assert_eq!(
                found("Bose")?,
                0,
                "the name they no longer go by does not still find them"
            );

            // This reads the index against itself rather than against the clients
            // table, so on its own it would pass an index that had drifted; it is
            // the searches above that say the index is right, and this that says
            // it is also sound.
            conn.execute_batch("INSERT INTO clients_fts(clients_fts) VALUES('integrity-check')")?;

            // The WHEN clause 004 adds is on the index trigger and not on
            // clients_touch, so an edit still stamps the row.
            conn.execute_batch("UPDATE clients SET created_at = '2000-01-01 00:00:00'")?;
            let (created, updated): (String, String) =
                conn.query_row("SELECT created_at, updated_at FROM clients", [], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })?;
            assert!(updated > created, "an edit still moves updated_at");
            Ok(())
        })
        .unwrap();
}

/// The health details a proposal carries: stored as chosen, handed back as a
/// list, held to the words the app knows, and carried into the next year.
#[test]
fn a_health_policy_keeps_the_detail_its_proposal_was_written_on() {
    let temp = TempDb::new("health-details");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Rohit Sharma"))?;
            let insurer = insurers::find_or_create(conn, "Star Health")?;

            let id = policies::create(
                conn,
                &PolicyInput {
                    variant: Some("Gold".into()),
                    // Chosen in whatever order they were clicked, and out of the
                    // order the insurer lists them in.
                    riders: Some(vec!["future_ready".into(), "safeguard".into()]),
                    plan_type: Some("family_floater".into()),
                    term: Some(3),
                    policy_type: Some("portability".into()),
                    broker: Some("Deshmukh Insurance Services".into()),
                    inbuilt_rider: Some("Road ambulance cover".into()),
                    ..sample_policy(client, insurer, "HS/2026/001", "2029-03-31")
                },
            )?;

            let policy = policies::get(conn, id)?;
            assert_eq!(
                policy.riders,
                vec!["safeguard".to_string(), "future_ready".to_string()],
                "riders come back in the insurer's order, not the order of clicking"
            );
            assert_eq!(policy.variant.as_deref(), Some("Gold"));
            assert_eq!(policy.plan_type.as_deref(), Some("family_floater"));
            assert_eq!(policy.term, Some(3));
            assert_eq!(policy.policy_type.as_deref(), Some("portability"));
            assert_eq!(
                policy.inbuilt_rider.as_deref(),
                Some("Road ambulance cover")
            );

            let next = policies::renew(
                conn,
                &RenewalInput {
                    policy_id: id,
                    policy_number: Some("HS/2029/002".into()),
                    ..Default::default()
                },
            )?;
            let renewed = policies::get(conn, next)?;

            assert_eq!(
                renewed.expiry_date, "2032-03-31",
                "three years were bought, so three years are renewed"
            );
            assert_eq!(renewed.riders, policy.riders, "the riders come along");
            assert_eq!(renewed.variant.as_deref(), Some("Gold"));
            assert_eq!(
                renewed.policy_type.as_deref(),
                Some("renewal"),
                "a ported year renews into a renewal"
            );

            Ok(())
        })
        .unwrap();
}

/// The core takes the health details on trust as to whether they are there, and
/// not at all as to what they say.
#[test]
fn the_health_details_are_held_to_the_words_the_app_knows() {
    let temp = TempDb::new("health-words");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Rohit Sharma"))?;
            let insurer = insurers::find_or_create(conn, "Star Health")?;

            /// A policy number, and the one answer on it that is not a word the
            /// app knows.
            type Spoiler = (&'static str, fn(&mut PolicyInput));

            let spoilers: [Spoiler; 4] = [
                ("HS/2026/010", |p| p.plan_type = Some("floater".into())),
                ("HS/2026/011", |p| p.policy_type = Some("port".into())),
                ("HS/2026/012", |p| {
                    p.riders = Some(vec!["gold_cover".into()])
                }),
                ("HS/2026/013", |p| p.term = Some(9)),
            ];
            for (number, spoil) in spoilers {
                let mut input = sample_policy(client, insurer, number, "2027-03-31");
                spoil(&mut input);
                assert!(
                    matches!(
                        policies::create(conn, &input),
                        Err(crate::error::AppError::Validation(_))
                    ),
                    "{number} should have been refused"
                );
            }

            // A book that predates the questions still goes in: the screen asks
            // for these, the core does not.
            let plain = policies::create(
                conn,
                &sample_policy(client, insurer, "HS/2026/014", "2027-03-31"),
            )?;
            let bare = policies::get(conn, plain)?;
            assert!(bare.riders.is_empty());
            assert_eq!(bare.plan_type, None);

            Ok(())
        })
        .unwrap();
}

#[test]
fn renewal_builds_a_chain_and_preserves_history() {
    let temp = TempDb::new("renew");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Rohit Sharma"))?;
            let insurer = insurers::find_or_create(conn, "Star Health")?;
            let first = policies::create(
                conn,
                &sample_policy(client, insurer, "HS/2026/001", "2027-03-31"),
            )?;

            let second = policies::renew(
                conn,
                &RenewalInput {
                    policy_id: first,
                    policy_number: Some("HS/2027/002".into()),
                    start_date: None,
                    expiry_date: None,
                    sum_insured: Some(1_500_000.0),
                    premium_amount: Some(27_000.0),
                    gst_amount: None,
                    commission_rate: None,
                    commission_expected: None,
                    notes: Some("Cover increased".into()),
                },
            )?;

            let old = policies::get(conn, first)?;
            let new = policies::get(conn, second)?;

            assert_eq!(old.status, "renewed");
            assert_eq!(
                old.premium_amount,
                Some(24_500.0),
                "last year's premium must survive"
            );
            assert!(old.is_renewed);

            assert_eq!(new.policy_year, 2);
            assert_eq!(new.previous_policy_id, Some(first));
            assert_eq!(new.chain_id, old.chain_id);
            assert_eq!(new.start_date, "2027-04-01", "starts the day after expiry");
            assert_eq!(new.expiry_date, "2028-03-31", "runs a year minus a day");
            assert_eq!(new.sum_insured, Some(1_500_000.0));
            // Carried forward because the renewal did not restate it.
            assert_eq!(new.commission_rate, Some(15.0));

            let chain = policies::chain(conn, second)?;
            assert_eq!(chain.len(), 2);
            assert_eq!(chain[0].policy_year, 1);

            // The latest year is the one without a successor.
            let latest = policies::list(
                conn,
                &PolicyFilter {
                    latest_only: Some(true),
                    ..Default::default()
                },
            )?;
            assert_eq!(latest.total, 1);
            assert_eq!(latest.rows[0].id, second);
            Ok(())
        })
        .unwrap();
}

#[test]
fn statuses_follow_the_calendar() {
    let temp = TempDb::new("status");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Vikram Rao"))?;
            let insurer = insurers::find_or_create(conn, "HDFC ERGO")?;

            let long_gone = util::iso(util::today() - chrono::Duration::days(90));
            let recent = util::iso(util::today() - chrono::Duration::days(5));
            let future = util::iso(util::today() + chrono::Duration::days(120));

            let mut lapsed_input = sample_policy(client, insurer, "A-1", &long_gone);
            lapsed_input.start_date = util::iso(util::today() - chrono::Duration::days(455));
            let lapsed = policies::create(conn, &lapsed_input)?;

            let mut expired_input = sample_policy(client, insurer, "A-2", &recent);
            expired_input.start_date = util::iso(util::today() - chrono::Duration::days(370));
            let expired = policies::create(conn, &expired_input)?;

            let active = policies::create(conn, &sample_policy(client, insurer, "A-3", &future))?;

            policies::sync_statuses(conn)?;

            assert_eq!(policies::get(conn, lapsed)?.status, "lapsed");
            assert_eq!(policies::get(conn, expired)?.status, "expired");
            assert_eq!(policies::get(conn, active)?.status, "active");

            let summary = dashboard::load(conn)?;
            assert_eq!(summary.expired_unrenewed, 2);
            assert_eq!(summary.active_policies, 1);
            assert!(summary
                .buckets
                .iter()
                .any(|b| b.label == "Overdue" && b.count == 2));
            Ok(())
        })
        .unwrap();
}

#[test]
fn duplicate_policy_number_for_same_insurer_is_rejected() {
    let temp = TempDb::new("dupe");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Meera Iyer"))?;
            let insurer = insurers::find_or_create(conn, "Care Health")?;
            policies::create(
                conn,
                &sample_policy(client, insurer, "SAME-1", "2027-01-01"),
            )?;

            let again = policies::create(
                conn,
                &sample_policy(client, insurer, "SAME-1", "2028-01-01"),
            );
            assert!(matches!(again, Err(crate::error::AppError::Conflict(_))));
            Ok(())
        })
        .unwrap();
}

#[test]
fn two_insurers_may_each_use_the_same_policy_number() {
    let temp = TempDb::new("number-scope");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Ishaan Bose"))?;
            let star = insurers::find_or_create(conn, "Star Health")?;
            let care = insurers::find_or_create(conn, "Care Health")?;
            assert_ne!(star, care);

            policies::create(conn, &sample_policy(client, star, "POL-7", "2027-03-31"))?;
            let other = policies::create(conn, &sample_policy(client, care, "POL-7", "2027-03-31"));
            assert!(
                other.is_ok(),
                "a number is only spoken for within the insurer that issued it"
            );
            Ok(())
        })
        .unwrap();
}

fn sample_insurer(name: &str, short_code: &str, active: bool) -> InsurerInput {
    InsurerInput {
        name: name.into(),
        short_code: Some(short_code.into()),
        website: None,
        claim_helpline: None,
        support_email: None,
        notes: None,
        is_active: Some(active),
    }
}

fn sample_product(insurer_id: i64, name: &str) -> ProductInput {
    ProductInput {
        insurer_id,
        name: name.into(),
        category: "health".into(),
        code: None,
        notes: None,
        is_active: Some(true),
    }
}

#[test]
fn an_insurer_carrying_policies_is_retired_rather_than_deleted() {
    let temp = TempDb::new("insurer-guard");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Nikhil Jain"))?;
            let insurer = insurers::create(
                conn,
                &sample_insurer("Zenith General Insurance", "zen", true),
            )?;
            let plan = products::create(conn, &sample_product(insurer, "Zenith Secure"))?;

            let mut input = sample_policy(client, insurer, "Z-1", "2027-03-31");
            input.product_id = Some(plan);
            let policy = policies::create(conn, &input)?;

            let message = match insurers::delete(conn, insurer) {
                Err(crate::error::AppError::Conflict(message)) => message,
                _ => panic!("an insurer holding policies must not be deletable"),
            };
            assert!(
                message.contains('1') && message.contains("Deactivate"),
                "the refusal says how many are in the way and what to do instead: {message}"
            );

            // Deactivating is the way to retire one, and it leaves the history
            // behind it readable.
            insurers::update(
                conn,
                insurer,
                &sample_insurer("Zenith General Insurance", "ZEN", false),
            )?;
            assert!(!insurers::list(conn, false)?.iter().any(|i| i.id == insurer));
            assert!(insurers::list(conn, true)?.iter().any(|i| i.id == insurer));
            assert!(
                !insurers::lookup(conn)?.iter().any(|i| i.id == insurer),
                "a retired insurer is off the pickers for new policies"
            );
            assert_eq!(
                policies::get(conn, policy)?.insurer_name,
                "Zenith General Insurance"
            );

            // Once nothing points at it, it can go, and its plans go with it.
            policies::delete(conn, policy)?;
            insurers::delete(conn, insurer)?;
            let plans_left: i64 = conn.query_row(
                "SELECT COUNT(*) FROM products WHERE id = ?1",
                [plan],
                |row| row.get(0),
            )?;
            assert_eq!(plans_left, 0);
            Ok(())
        })
        .unwrap();
}

#[test]
fn deleting_a_plan_leaves_the_policies_that_used_it() {
    let temp = TempDb::new("plan-delete");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Sneha Patil"))?;
            let insurer = insurers::find_or_create(conn, "Star Health")?;
            let plan = products::create(conn, &sample_product(insurer, "Family Health Optima"))?;

            let mut input = sample_policy(client, insurer, "P-1", "2027-03-31");
            input.product_id = Some(plan);
            let policy = policies::create(conn, &input)?;
            assert_eq!(policies::get(conn, policy)?.product_id, Some(plan));

            products::delete(conn, plan)?;

            // A catalogue tidy-up must not take a policy year with it.
            let after = policies::get(conn, policy)?;
            assert_eq!(after.product_id, None, "the policy forgets which plan");
            assert_eq!(after.product_name, None);
            assert_eq!(after.premium_amount, Some(24_500.0), "and keeps the rest");
            assert_eq!(after.status, "active");

            assert!(matches!(
                products::delete(conn, plan),
                Err(crate::error::AppError::NotFound("Plan"))
            ));
            Ok(())
        })
        .unwrap();
}

#[test]
fn an_abbreviated_insurer_name_finds_the_one_already_in_the_book() {
    let temp = TempDb::new("insurer-matching");
    temp.db
        .with(|conn| {
            let seeded = insurers::list(conn, true)?.len();

            // Spreadsheets write the short version; the seed carries the long one.
            let star = insurers::find_or_create(conn, "Star Health")?;
            let matched = insurers::list(conn, true)?
                .into_iter()
                .find(|i| i.id == star)
                .expect("the insurer it matched should be in the list");
            assert_eq!(matched.name, "Star Health and Allied Insurance");
            assert_eq!(
                insurers::list(conn, true)?.len(),
                seeded,
                "matching an abbreviation must not add a second version of it"
            );

            assert_eq!(
                insurers::find_or_create(conn, "  star health and allied insurance  ")?,
                star,
                "case and surrounding space are not a different insurer"
            );
            assert_eq!(
                insurers::find_or_create(conn, "STAR")?,
                star,
                "nor is the short code"
            );

            // A name nothing matches is added rather than guessed at.
            let fresh = insurers::find_or_create(conn, "Zenith General Insurance")?;
            assert_eq!(insurers::list(conn, true)?.len(), seeded + 1);
            assert_eq!(
                insurers::find_or_create(conn, "Zenith General Insurance Company Limited")?,
                fresh,
                "a longer spelling of the same name is the same insurer"
            );
            assert_eq!(insurers::list(conn, true)?.len(), seeded + 1);

            assert!(matches!(
                insurers::find_or_create(conn, "   "),
                Err(crate::error::AppError::Validation(_))
            ));
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_plan_is_unique_to_its_insurer_and_needs_a_known_category() {
    let temp = TempDb::new("plans");
    temp.db
        .with(|conn| {
            let star = insurers::find_or_create(conn, "Star Health")?;
            let care = insurers::find_or_create(conn, "Care Health")?;

            let first = products::create(conn, &sample_product(star, "Family Health Optima"))?;
            assert!(
                matches!(
                    products::create(conn, &sample_product(star, "Family Health Optima")),
                    Err(crate::error::AppError::Conflict(_))
                ),
                "one insurer cannot list the same plan twice"
            );
            products::create(conn, &sample_product(care, "Family Health Optima"))?;

            let mut nonsense = sample_product(star, "Odd One Out");
            nonsense.category = "spaceship".into();
            assert!(matches!(
                products::create(conn, &nonsense),
                Err(crate::error::AppError::Validation(_))
            ));

            // The importer resolves a plan name within the insurer, and declines
            // to invent one from an empty cell.
            assert_eq!(
                products::find_or_create(conn, star, "Family Health Optima", "health")?,
                Some(first)
            );
            assert_eq!(products::find_or_create(conn, star, "   ", "health")?, None);
            assert!(products::find_or_create(conn, star, "Young Star", "health")?.is_some());
            assert_eq!(
                products::list(conn, Some(star), false)?.len(),
                2,
                "only the two plans that insurer actually offers"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_cancelled_policy_is_left_alone_by_the_sweep() {
    let temp = TempDb::new("cancelled");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Farah Sheikh"))?;
            let insurer = insurers::find_or_create(conn, "HDFC ERGO")?;

            // One that the calendar would call lapsed, one it would call active.
            let mut old_input = sample_policy(
                client,
                insurer,
                "X-1",
                &util::iso(util::today() - chrono::Duration::days(90)),
            );
            old_input.start_date = util::iso(util::today() - chrono::Duration::days(455));
            let long_gone = policies::create(conn, &old_input)?;
            let current = policies::create(
                conn,
                &sample_policy(
                    client,
                    insurer,
                    "X-2",
                    &util::iso(util::today() + chrono::Duration::days(120)),
                ),
            )?;

            policies::set_status(conn, long_gone, "cancelled")?;
            policies::set_status(conn, current, "cancelled")?;
            policies::sync_statuses(conn)?;

            // Cancelling is a decision somebody made; the calendar does not get
            // to overrule it in either direction.
            assert_eq!(policies::get(conn, long_gone)?.status, "cancelled");
            assert_eq!(policies::get(conn, current)?.status, "cancelled");

            let summary = dashboard::load(conn)?;
            assert_eq!(summary.active_policies, 0);
            Ok(())
        })
        .unwrap();
}

#[test]
fn renewing_a_cancelled_year_leaves_it_cancelled() {
    let temp = TempDb::new("renew-cancelled");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Imran Qureshi"))?;
            let insurer = insurers::find_or_create(conn, "Star Health")?;
            let first =
                policies::create(conn, &sample_policy(client, insurer, "C-1", "2027-03-31"))?;
            policies::set_status(conn, first, "cancelled")?;

            // The client came back and took cover again for the following year.
            let second = policies::renew(
                conn,
                &RenewalInput {
                    policy_id: first,
                    policy_number: Some("C-2".into()),
                    start_date: None,
                    expiry_date: None,
                    sum_insured: None,
                    premium_amount: None,
                    gst_amount: None,
                    commission_rate: None,
                    commission_expected: None,
                    notes: None,
                },
            )?;

            let cancelled = policies::get(conn, first)?;
            assert_eq!(
                cancelled.status, "cancelled",
                "the book still says the cover was ended early"
            );
            assert!(
                cancelled.is_renewed,
                "and still knows a later year replaced it, which is what keeps \
                 it off the renewals desk"
            );

            // The sweep must not talk it round either way.
            policies::sync_statuses(conn)?;
            assert_eq!(policies::get(conn, first)?.status, "cancelled");

            let chain = policies::chain(conn, second)?;
            assert_eq!(
                chain.iter().filter(|p| !p.is_renewed).count(),
                1,
                "one open year, as in any chain"
            );

            // And it cannot be renewed a second time into a forked chain.
            let again = policies::renew(
                conn,
                &RenewalInput {
                    policy_id: first,
                    policy_number: Some("C-3".into()),
                    start_date: None,
                    expiry_date: None,
                    sum_insured: None,
                    premium_amount: None,
                    gst_amount: None,
                    commission_rate: None,
                    commission_expected: None,
                    notes: None,
                },
            );
            assert!(
                matches!(again, Err(crate::error::AppError::Conflict(_))),
                "a year that has been renewed cannot be renewed again"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn an_expiry_moved_forward_brings_a_policy_back() {
    let temp = TempDb::new("revive");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Tara Menon"))?;
            let insurer = insurers::find_or_create(conn, "Bajaj Allianz")?;

            let start = util::iso(util::today() - chrono::Duration::days(370));
            let mut input = sample_policy(
                client,
                insurer,
                "R-1",
                &util::iso(util::today() - chrono::Duration::days(5)),
            );
            input.start_date = start.clone();
            let id = policies::create(conn, &input)?;

            policies::sync_statuses(conn)?;
            assert_eq!(policies::get(conn, id)?.status, "expired");

            // The date was typed wrong and has been corrected.
            let mut corrected = sample_policy(
                client,
                insurer,
                "R-1",
                &util::iso(util::today() + chrono::Duration::days(120)),
            );
            corrected.start_date = start;
            policies::update(conn, id, &corrected)?;
            assert_eq!(
                policies::get(conn, id)?.status,
                "expired",
                "an edit that says nothing about status does not decide one"
            );

            policies::sync_statuses(conn)?;
            assert_eq!(
                policies::get(conn, id)?.status,
                "active",
                "the sweep reads the corrected date and puts it back"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn editing_a_policy_leaves_its_place_in_the_chain_alone() {
    let temp = TempDb::new("edit");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Kabir Malhotra"))?;
            let insurer = insurers::find_or_create(conn, "ICICI Lombard")?;
            let first =
                policies::create(conn, &sample_policy(client, insurer, "C-1", "2027-03-31"))?;
            let second = policies::renew(
                conn,
                &RenewalInput {
                    policy_id: first,
                    policy_number: Some("C-2".into()),
                    start_date: None,
                    expiry_date: None,
                    sum_insured: None,
                    premium_amount: None,
                    gst_amount: None,
                    commission_rate: None,
                    commission_expected: None,
                    notes: None,
                },
            )?;
            let before = policies::get(conn, second)?;

            let mut edit = sample_policy(client, insurer, "C-2-revised", "2028-03-31");
            edit.start_date = before.start_date.clone();
            edit.premium_amount = Some(31_000.0);
            policies::update(conn, second, &edit)?;

            let after = policies::get(conn, second)?;
            assert_eq!(after.policy_number, "C-2-revised");
            assert_eq!(after.premium_amount, Some(31_000.0));
            assert_eq!(after.chain_id, before.chain_id, "still the same policy");
            assert_eq!(after.policy_year, 2);
            assert_eq!(after.previous_policy_id, Some(first));
            assert_eq!(
                policies::get(conn, first)?.status,
                "renewed",
                "last year is not disturbed by an edit to this one"
            );

            // A status supplied deliberately is honoured.
            let mut cancelling = sample_policy(client, insurer, "C-2-revised", "2028-03-31");
            cancelling.start_date = before.start_date;
            cancelling.status = Some("cancelled".into());
            policies::update(conn, second, &cancelling)?;
            assert_eq!(policies::get(conn, second)?.status, "cancelled");
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_policy_renumbered_or_filled_in_is_still_the_one_the_lists_find() {
    let temp = TempDb::new("policy-edit-search");
    temp.db
        .with(|conn| {
            let client = clients::create(
                conn,
                &ClientInput {
                    full_name: "Ravi Bose".into(),
                    ..Default::default()
                },
            )?;
            let insurer = insurers::find_or_create(conn, "Star Health")?;
            let id = policies::create(
                conn,
                &sample_policy(client, insurer, "SH/2026/1", "2027-03-31"),
            )?;

            // policies_touch nests an update the same way clients_touch does, but
            // there is no search index on policies for it to disturb: policy
            // search is a LIKE over policy_overview. This is the proof of that,
            // and of the client index surviving a policy edited beside it.
            let mut edit = sample_policy(client, insurer, "SH/2026/1-A", "2027-03-31");
            edit.vehicle_number = Some("MH 12 AB 3456".into());
            policies::update(conn, id, &edit)?;

            let found = |term: &str| -> crate::error::AppResult<i64> {
                Ok(policies::list(
                    conn,
                    &PolicyFilter {
                        search: Some(term.into()),
                        ..Default::default()
                    },
                )?
                .total)
            };
            assert_eq!(policies::get(conn, id)?.policy_number, "SH/2026/1-A");
            assert_eq!(found("SH/2026/1-A")?, 1, "the number it now carries");
            assert_eq!(found("MH 12 AB 3456")?, 1, "and the vehicle just recorded");

            // The lists read the client's name through the view, so renaming the
            // client has to move the policy with them.
            clients::update(
                conn,
                client,
                &ClientInput {
                    full_name: "Ravi Kumar Sharma".into(),
                    email: Some("ravi@example.com".into()),
                    pan: Some("abcde1234f".into()),
                    ..Default::default()
                },
            )?;
            assert_eq!(found("Sharma")?, 1);
            assert_eq!(found("Bose")?, 0);
            assert_eq!(
                clients::list(
                    conn,
                    &ClientFilter {
                        search: Some("Sharma".into()),
                        ..Default::default()
                    }
                )?
                .total,
                1
            );
            conn.execute_batch("INSERT INTO clients_fts(clients_fts) VALUES('integrity-check')")?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn only_the_statuses_the_app_knows_are_accepted() {
    let temp = TempDb::new("statuses");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Anil Kapoor"))?;
            let insurer = insurers::find_or_create(conn, "Star Health")?;
            let id = policies::create(conn, &sample_policy(client, insurer, "S-1", "2027-03-31"))?;

            for status in ["active", "expired", "renewed", "lapsed", "cancelled"] {
                policies::set_status(conn, id, status)?;
                assert_eq!(policies::get(conn, id)?.status, status);
            }

            assert!(
                matches!(
                    policies::set_status(conn, id, "archived"),
                    Err(crate::error::AppError::Validation(_))
                ),
                "a status the rest of the app cannot read is refused"
            );
            assert_eq!(
                policies::get(conn, id)?.status,
                "cancelled",
                "and the refused write changes nothing"
            );
            assert!(matches!(
                policies::set_status(conn, 9_999, "active"),
                Err(crate::error::AppError::NotFound("Policy"))
            ));
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_chain_keeps_exactly_one_open_year() {
    let temp = TempDb::new("chain-head");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Divya Krishnan"))?;
            let insurer = insurers::find_or_create(conn, "Star Health")?;
            let year_one =
                policies::create(conn, &sample_policy(client, insurer, "Y-1", "2027-03-31"))?;

            let renew_as = |conn: &_, previous, number: &str| {
                policies::renew(
                    conn,
                    &RenewalInput {
                        policy_id: previous,
                        policy_number: Some(number.into()),
                        start_date: None,
                        expiry_date: None,
                        sum_insured: None,
                        premium_amount: None,
                        gst_amount: None,
                        commission_rate: None,
                        commission_expected: None,
                        notes: None,
                    },
                )
            };
            let year_two = renew_as(conn, year_one, "Y-2")?;
            let year_three = renew_as(conn, year_two, "Y-3")?;

            let chain = policies::chain(conn, year_two)?;
            assert_eq!(
                chain.iter().map(|p| p.policy_year).collect::<Vec<_>>(),
                vec![1, 2, 3],
                "the chain reads in order from any year in it"
            );
            assert_eq!(
                chain.iter().filter(|p| !p.is_renewed).count(),
                1,
                "however long the chain, one year is open"
            );
            assert_eq!(chain[2].id, year_three);

            let latest = policies::list(
                conn,
                &PolicyFilter {
                    latest_only: Some(true),
                    ..Default::default()
                },
            )?;
            assert_eq!(latest.total, 1);
            assert_eq!(latest.rows[0].id, year_three);

            // Three years of history, one policy on the desk.
            let everything = policies::list(conn, &PolicyFilter::default())?;
            assert_eq!(everything.total, 3);
            Ok(())
        })
        .unwrap();
}

#[test]
fn deleting_a_year_leaves_the_earlier_ones_standing() {
    let temp = TempDb::new("delete-year");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Rahul Verma"))?;
            let insurer = insurers::find_or_create(conn, "Star Health")?;
            let first =
                policies::create(conn, &sample_policy(client, insurer, "D-1", "2027-03-31"))?;
            let second = policies::renew(
                conn,
                &RenewalInput {
                    policy_id: first,
                    policy_number: Some("D-2".into()),
                    start_date: None,
                    expiry_date: None,
                    sum_insured: None,
                    premium_amount: None,
                    gst_amount: None,
                    commission_rate: None,
                    commission_expected: None,
                    notes: None,
                },
            )?;

            policies::delete(conn, second)?;

            let remaining = policies::chain(conn, first)?;
            assert_eq!(remaining.len(), 1, "the year that was deleted is gone");
            assert_eq!(remaining[0].id, first);
            assert_eq!(
                remaining[0].premium_amount,
                Some(24_500.0),
                "and the year before it is untouched"
            );
            assert!(
                !remaining[0].is_renewed,
                "with its successor removed it is the open year again"
            );

            assert!(matches!(
                policies::get(conn, second),
                Err(crate::error::AppError::NotFound("Policy"))
            ));
            assert!(matches!(
                policies::delete(conn, second),
                Err(crate::error::AppError::NotFound("Policy"))
            ));

            // Losing its successor puts the year back at the head of the chain,
            // so the sweep has to stop calling it renewed and read the calendar
            // for it again. Otherwise a live policy sits off the renewals desk.
            policies::sync_statuses(conn)?;
            assert_eq!(policies::get(conn, first)?.status, "active");

            // Which open state it lands in is the calendar's decision, not the
            // deletion's.
            let mut lapsing = sample_policy(
                client,
                insurer,
                "D-3",
                &util::iso(util::today() - chrono::Duration::days(10)),
            );
            lapsing.start_date = util::iso(util::today() - chrono::Duration::days(375));
            let older = policies::create(conn, &lapsing)?;
            let replacement = policies::renew(
                conn,
                &RenewalInput {
                    policy_id: older,
                    policy_number: Some("D-4".into()),
                    start_date: None,
                    expiry_date: None,
                    sum_insured: None,
                    premium_amount: None,
                    gst_amount: None,
                    commission_rate: None,
                    commission_expected: None,
                    notes: None,
                },
            )?;
            policies::delete(conn, replacement)?;
            policies::sync_statuses(conn)?;
            assert_eq!(policies::get(conn, older)?.status, "expired");
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_policy_covers_its_holder_or_someone_related_to_them() {
    let temp = TempDb::new("members");
    temp.db
        .with(|conn| {
            let owner = clients::create(conn, &sample_client("Owner One"))?;
            let stranger = clients::create(conn, &sample_client("Stranger Two"))?;
            let insurer = insurers::find_or_create(conn, "Niva Bupa")?;
            let policy =
                policies::create(conn, &sample_policy(owner, insurer, "M-1", "2027-06-30"))?;

            let mine =
                relations::find_or_create_relative(conn, owner, "Spouse Name", Some("wife"))?;
            let theirs = relations::find_or_create_relative(conn, stranger, "Other Person", None)?;

            // The holder themselves, the spouse, and somebody from another family.
            policies::set_members(conn, policy, &[owner, mine, theirs])?;
            let attached = policies::insured_of(conn, policy)?;
            let mut expected = vec![owner, mine];
            expected.sort();
            assert_eq!(
                attached, expected,
                "the holder and his own family, and nobody else's"
            );

            let listed = relations::list_for_client(conn, owner)?;
            assert_eq!(listed.len(), 1);
            assert_eq!(
                listed[0].relationship, "spouse",
                "\"wife\" from a spreadsheet is the spouse edge"
            );
            assert!(
                listed[0].own_policies == 0 && listed[0].client_code.starts_with("CL-"),
                "a life named on a policy became a client with a code of her own"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_life_named_on_a_policy_is_not_entered_twice() {
    let temp = TempDb::new("member-dedupe");
    temp.db
        .with(|conn| {
            let holder = clients::create(conn, &sample_client("Rajesh Kumar"))?;

            // The holder's own name in his cover list is him, not a second Rajesh.
            // This is what the 'self' member row used to stand for.
            let himself = relations::find_or_create_relative(conn, holder, "Rajesh Kumar", None)?;
            assert_eq!(himself, holder);

            let wife =
                relations::find_or_create_relative(conn, holder, "Priya Kumar", Some("wife"))?;
            // The same sheet imported again finds her rather than opening a second
            // client, which is what makes a re-import idempotent.
            let again = relations::find_or_create_relative(conn, holder, "priya kumar", None)?;
            assert_eq!(again, wife, "matched within the family, case-insensitively");

            let clients_total: i64 =
                conn.query_row("SELECT COUNT(*) FROM clients", [], |row| row.get(0))?;
            assert_eq!(clients_total, 2, "the holder and his wife");

            // She inherited the household's city, so the client list's filters
            // still find her where she lives.
            assert_eq!(
                clients::get(conn, wife)?.city,
                clients::get(conn, holder)?.city
            );

            // A relationship the file states corrects one that arrived blank,
            // which is what makes a re-import a way to repair a book rather than
            // only a way to avoid duplicating it.
            assert_eq!(
                relations::list_for_client(conn, holder)?[0].relationship,
                "spouse"
            );
            relations::find_or_create_relative(conn, holder, "Priya Kumar", Some("mother"))?;
            assert_eq!(
                relations::list_for_client(conn, holder)?[0].relationship,
                "mother",
                "the word the file gives is recorded on the pair already there"
            );
            relations::find_or_create_relative(conn, holder, "Priya Kumar", None)?;
            assert_eq!(
                relations::list_for_client(conn, holder)?[0].relationship,
                "mother",
                "and a file that says nothing does not flatten it back to other"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_relationship_written_beside_a_name_is_read_rather_than_swallowed() {
    // Agency registers write the word next to the person. It used to become part
    // of the name: the book gained a client called "Sneha Sharma (wife)" and a
    // second copy of the policyholder called "Rohit Sharma (self)".
    for (entry, expected_name, expected_word) in [
        ("Sneha Sharma (Wife)", "Sneha Sharma", Some("spouse")),
        ("Sneha Sharma [wife]", "Sneha Sharma", Some("spouse")),
        ("Wife - Sneha Sharma", "Sneha Sharma", Some("spouse")),
        ("Wife: Sneha Sharma", "Sneha Sharma", Some("spouse")),
        ("Sneha Sharma - wife", "Sneha Sharma", Some("spouse")),
        ("Aarav Sharma (son)", "Aarav Sharma", Some("son")),
        ("Rohit Sharma (Self)", "Rohit Sharma", Some("self")),
        // Nothing recognised, so nothing is taken out of the name.
        ("Anne-Marie Fernandes", "Anne-Marie Fernandes", None),
        ("T. R. Krishnan", "T. R. Krishnan", None),
        ("Maria D'Souza & Sons", "Maria D'Souza & Sons", None),
        ("Priya Menon (nominee)", "Priya Menon (nominee)", None),
        // A word with nobody attached to it names nobody.
        ("Self", "", Some("self")),
        ("wife", "", Some("spouse")),
    ] {
        let (name, word) = util::split_relationship(entry);
        assert_eq!(
            (name, word),
            (expected_name, expected_word),
            "reading {entry:?}"
        );
    }
}

#[test]
fn a_cover_list_takes_its_relationships_from_the_row() {
    let temp = TempDb::new("cover-relationships");
    temp.db
        .with(|conn| {
            let insurer = insurers::find_or_create(conn, "Star Health")?;
            let holder = clients::create(conn, &sample_client("Rohit Sharma"))?;
            let policy = policies::create(
                conn,
                &PolicyInput {
                    nominee_name: Some("Lakshmi Sharma".into()),
                    nominee_relation: Some("Mother".into()),
                    ..sample_policy(holder, insurer, "SH-1", "2027-06-30")
                },
            )?;

            // Two words written beside the name, one taken from the nominee
            // columns, and the holder named the way a register names them.
            let mut ids = Vec::new();
            for entry in [
                "Self",
                "Sneha Sharma (Wife)",
                "son - Aarav Sharma",
                "Lakshmi Sharma",
            ] {
                let (name, beside) = util::split_relationship(entry);
                if name.is_empty() {
                    ids.push(holder);
                    continue;
                }
                let word = beside.map(str::to_owned).or_else(|| {
                    "Lakshmi Sharma"
                        .eq_ignore_ascii_case(name)
                        .then(|| "Mother".to_string())
                });
                ids.push(relations::find_or_create_relative(
                    conn,
                    holder,
                    name,
                    word.as_deref(),
                )?);
            }
            policies::set_members(conn, policy, &ids)?;

            let mut recorded: Vec<(String, String)> = relations::list_for_client(conn, holder)?
                .into_iter()
                .map(|r| (r.full_name, r.relationship))
                .collect();
            recorded.sort();
            assert_eq!(
                recorded,
                vec![
                    ("Aarav Sharma".to_string(), "son".to_string()),
                    ("Lakshmi Sharma".to_string(), "mother".to_string()),
                    ("Sneha Sharma".to_string(), "spouse".to_string()),
                ],
                "every relationship the row carried, and no client named after one"
            );

            assert_eq!(
                policies::insured_of(conn, policy)?.len(),
                4,
                "the holder and the three lives named beside him"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn spreadsheet_import_maps_headers_and_is_idempotent() {
    let temp = TempDb::new("import");
    let csv_path = temp.dir.join("book.csv");

    // Deliberately messy: agency-style headers, day-first dates, currency symbols.
    std::fs::write(
        &csv_path,
        "Customer Name,Mobile No,Email ID,Policy No,Insurance Company,Plan Name,Policy Type,\
Risk Start,Valid Till,Sum Insured,Gross Premium,City,Members\n\
Rohit Sharma,98765 43210,rohit@example.com,HS/2026/1,Star Health,Family Health Optima,Mediclaim,\
01/04/2026,31/03/2027,\"₹10,00,000\",\"Rs. 24,500\",Pune,Rohit Sharma; Anita Sharma\n\
Vikram Rao,9812345678,vikram@example.com,MOT/2026/9,ICICI Lombard,Private Car Package,Motor,\
15/06/2026,14/06/2027,300000,8750,Nashik,\n\
Broken Row,,,,,,,,,,,,\n",
    )
    .unwrap();

    let preview = importer::preview(&csv_path, None).unwrap();
    assert_eq!(preview.total_rows, 3);
    let mapping = preview.suggested_mapping.clone();
    assert_eq!(
        mapping.get("fullName").map(String::as_str),
        Some("Customer Name")
    );
    assert_eq!(
        mapping.get("policyNumber").map(String::as_str),
        Some("Policy No")
    );
    assert_eq!(
        mapping.get("insurerName").map(String::as_str),
        Some("Insurance Company")
    );
    assert_eq!(
        mapping.get("expiryDate").map(String::as_str),
        Some("Valid Till")
    );
    assert_eq!(
        mapping.get("premiumAmount").map(String::as_str),
        Some("Gross Premium")
    );

    let options = ImportOptions {
        path: csv_path.to_string_lossy().to_string(),
        sheet: None,
        mapping,
        default_category: Some("other".into()),
        update_existing: Some(true),
        dry_run: Some(true),
    };

    // A dry run reports but must not write.
    let dry = temp.db.with(|conn| importer::run(conn, &options)).unwrap();
    assert_eq!(dry.policies_inserted, 2);
    assert_eq!(
        dry.failed, 1,
        "the blank row should be reported, not imported"
    );

    // The report names the cell, so the agent knows which one to correct.
    let issue = &dry.issues[0];
    assert_eq!(issue.row, 4, "row 1 is the header and rows count from 1");
    assert_eq!(
        issue.column.as_deref(),
        Some("Policy No"),
        "the row has a name and no policy number, so that is the cell at fault"
    );
    assert_eq!(
        issue.value, None,
        "an empty cell has no value worth quoting back"
    );
    temp.db
        .with(|conn| {
            let total: i64 = conn.query_row("SELECT COUNT(*) FROM policies", [], |r| r.get(0))?;
            assert_eq!(total, 0, "a dry run must leave the database untouched");
            Ok(())
        })
        .unwrap();

    let real = ImportOptions {
        dry_run: Some(false),
        ..options
    };
    let report = temp.db.with(|conn| importer::run(conn, &real)).unwrap();
    assert_eq!(report.policies_inserted, 2);
    assert_eq!(report.clients_created, 2);

    temp.db
        .with(|conn| {
            let policy = policies::list(
                conn,
                &PolicyFilter {
                    search: Some("HS/2026/1".into()),
                    ..Default::default()
                },
            )?;
            let row = &policy.rows[0];
            assert_eq!(row.category, "health", "\"Mediclaim\" should map to health");
            assert_eq!(row.start_date, "2026-04-01", "day-first dates are honoured");
            assert_eq!(row.expiry_date, "2027-03-31");
            assert_eq!(
                row.sum_insured,
                Some(1_000_000.0),
                "currency formatting is stripped"
            );
            assert_eq!(row.premium_amount, Some(24_500.0));
            assert_eq!(row.product_name.as_deref(), Some("Family Health Optima"));

            let motor = policies::list(
                conn,
                &PolicyFilter {
                    categories: Some(vec!["motor".into()]),
                    ..Default::default()
                },
            )?;
            assert_eq!(motor.total, 1);

            // The sheet's cover list is "Rohit Sharma; Anita Sharma", and Rohit is
            // the policyholder. He resolves to himself rather than to a second
            // client of the same name, so the policy covers two people while the
            // book gained one.
            assert_eq!(
                policies::insured_of(conn, row.id)?.len(),
                2,
                "the holder and his wife are both covered"
            );
            let family = relations::list_for_client(conn, row.client_id)?;
            assert_eq!(family.len(), 1, "and only she was added to the book");
            assert_eq!(family[0].full_name, "Anita Sharma");
            Ok(())
        })
        .unwrap();

    // Re-importing the same file updates in place rather than duplicating.
    let again = temp.db.with(|conn| importer::run(conn, &real)).unwrap();
    assert_eq!(again.policies_inserted, 0);
    assert_eq!(again.policies_updated, 2);
    assert_eq!(again.clients_created, 0);

    temp.db
        .with(|conn| {
            let clients_total: i64 =
                conn.query_row("SELECT COUNT(*) FROM clients", [], |r| r.get(0))?;
            let policies_total: i64 =
                conn.query_row("SELECT COUNT(*) FROM policies", [], |r| r.get(0))?;
            // Two policyholders and the wife named in the cover column, who is a
            // client like them. The second import found her instead of opening a
            // fourth row, which is the whole point of matching within the family.
            assert_eq!((clients_total, policies_total), (3, 2));
            Ok(())
        })
        .unwrap();
}

#[test]
fn import_refuses_an_unmapped_required_field() {
    let temp = TempDb::new("import-guard");
    let path = temp.dir.join("thin.csv");
    std::fs::write(&path, "Name,Policy\nSomeone,P-1\n").unwrap();

    let options = ImportOptions {
        path: path.to_string_lossy().to_string(),
        sheet: None,
        mapping: std::collections::HashMap::from([("fullName".into(), "Name".into())]),
        default_category: None,
        update_existing: Some(true),
        dry_run: Some(true),
    };

    let outcome = temp.db.with(|conn| importer::run(conn, &options));
    assert!(matches!(
        outcome,
        Err(crate::error::AppError::Validation(_))
    ));
}

#[test]
fn export_writes_both_formats() {
    let temp = TempDb::new("export");
    let rows = temp
        .db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Export Target"))?;
            let insurer = insurers::find_or_create(conn, "Tata AIG")?;
            products::find_or_create(conn, insurer, "Medicare Premier", "health")?;
            policies::create(conn, &sample_policy(client, insurer, "EX-1", "2027-12-31"))?;
            policies::list_all(conn, &PolicyFilter::default())
        })
        .unwrap();
    assert_eq!(rows.len(), 1);

    for name in ["out.xlsx", "out.csv"] {
        let path = temp.dir.join(name);
        let written = crate::exporter::export_policies(&rows, &path).unwrap();
        assert_eq!(written, 1);
        assert!(path.exists());
        assert!(std::fs::metadata(&path).unwrap().len() > 0);
    }

    let bad = crate::exporter::export_policies(&rows, &temp.dir.join("out.pdf"));
    assert!(
        bad.is_err(),
        "unsupported formats should be refused clearly"
    );
}

#[test]
fn backup_produces_a_readable_copy() {
    let temp = TempDb::new("backup");
    let vault = Vault::create();
    let key = vault.derive_key("copy me").unwrap();
    let source = temp.dir.join("source.db");
    let db = Database::open(&source, &key).unwrap();
    db.with(|conn| {
        clients::create(conn, &sample_client("Backup Me"))?;
        Ok(())
    })
    .unwrap();

    let copy = temp.dir.join("copy.db");
    db.backup_to(&copy).unwrap();

    let restored = Database::open(&copy, &key).unwrap();
    restored
        .with(|conn| {
            let total: i64 = conn.query_row("SELECT COUNT(*) FROM clients", [], |r| r.get(0))?;
            assert_eq!(
                total, 1,
                "the backup should still be readable with the same key"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn dates_and_numbers_are_parsed_the_way_agencies_write_them() {
    assert_eq!(
        util::parse_date("31/03/2027").as_deref(),
        Some("2027-03-31")
    );
    assert_eq!(
        util::parse_date("31-03-2027").as_deref(),
        Some("2027-03-31")
    );
    assert_eq!(
        util::parse_date("2027-03-31").as_deref(),
        Some("2027-03-31")
    );
    assert_eq!(
        util::parse_date("31-Mar-2027").as_deref(),
        Some("2027-03-31")
    );
    assert_eq!(
        util::parse_date("2027-03-31T00:00:00").as_deref(),
        Some("2027-03-31")
    );
    // Excel serial for 2027-03-31.
    assert_eq!(util::parse_date("46477").as_deref(), Some("2027-03-31"));
    assert_eq!(util::parse_date("not a date"), None);
    assert_eq!(util::parse_date(""), None);

    assert_eq!(util::parse_number("₹10,00,000"), Some(1_000_000.0));
    assert_eq!(util::parse_number("Rs. 24,500.50"), Some(24_500.5));
    assert_eq!(util::parse_number("-"), None);

    // Money reads back in the Indian grouping the agency expects.
    assert_eq!(util::format_money(1_000_000.0, "INR"), "₹10,00,000");
    assert_eq!(util::format_money(24_500.5, "INR"), "₹24,500.50");
    assert_eq!(util::format_money(999.0, "INR"), "₹999");
    assert_eq!(util::format_date("2027-03-31", "dd/MM/yyyy"), "31/03/2027");
    assert_eq!(
        util::format_date("2027-03-31", "dd MMM yyyy"),
        "31 Mar 2027"
    );

    assert_eq!(
        util::expiry_after("2026-04-01", 1).as_deref(),
        Some("2027-03-31")
    );
    assert_eq!(
        util::expiry_after("2026-04-01", 3).as_deref(),
        Some("2029-03-31"),
        "a three-year term runs to the day before the third anniversary"
    );
    assert_eq!(
        util::expiry_after("2028-02-29", 1).as_deref(),
        Some("2029-02-27"),
        "a 29 February start has no anniversary in a common year"
    );
    assert_eq!(util::normalise_category("Two Wheeler Insurance"), "motor");
    assert_eq!(util::normalise_category("Overseas Travel"), "travel");
    assert_eq!(util::normalise_category("Term Plan"), "life");
    assert_eq!(
        util::normalise_phone("+91 98765-43210").as_deref(),
        Some("+919876543210")
    );
    assert!(util::looks_like_email("a@b.co"));
    assert!(!util::looks_like_email("a@b"));
    assert!(!util::looks_like_email("no at sign"));
}

// ------------------------------------------------------------------ reminders

/// Stands in for the mail server. Records what it was asked to send, and can be
/// told to fail so the retry path is exercised without a network.
#[derive(Default)]
struct FakeMail {
    sent: Mutex<Vec<(String, String)>>,
    fail_with: Option<String>,
}

impl FakeMail {
    fn failing(reason: &str) -> Self {
        Self {
            sent: Mutex::new(Vec::new()),
            fail_with: Some(reason.to_string()),
        }
    }

    fn count(&self) -> usize {
        self.sent.lock().unwrap().len()
    }

    fn recipients(&self) -> Vec<String> {
        self.sent
            .lock()
            .unwrap()
            .iter()
            .map(|(to, _)| to.clone())
            .collect()
    }
}

impl reminders::Sender for FakeMail {
    fn deliver(&self, message: &Outgoing) -> crate::error::AppResult<()> {
        if let Some(reason) = &self.fail_with {
            return Err(crate::error::AppError::mail(reason.clone()));
        }
        self.sent
            .lock()
            .unwrap()
            .push((message.to_email.clone(), message.subject.clone()));
        Ok(())
    }
}

/// A book with one client whose only policy expires in exactly `days`.
fn book_expiring_in(temp: &TempDb, days: i64, email: Option<&str>) -> (i64, i64) {
    temp.db
        .with_tx(|tx| {
            let mut input = sample_client("Ananya Sharma");
            input.email = email.map(str::to_string);
            let client_id = clients::create(tx, &input)?;
            let insurer_id = insurers::find_or_create(tx, "Star Health and Allied Insurance")?;
            let expiry = util::iso(util::today() + chrono::Duration::days(days));
            let policy_id = policies::create(
                tx,
                &sample_policy(client_id, insurer_id, "SH/2026/884213", &expiry),
            )?;
            settings::put(tx, "provider_name", "Sunrise Insurance Services")?;
            settings::put(tx, "digest_enabled", "false")?;
            Ok((client_id, policy_id))
        })
        .unwrap()
}

#[test]
fn a_rule_fires_on_its_day_and_not_before() {
    let temp = TempDb::new("rule-timing");
    book_expiring_in(&temp, 30, Some("ananya@example.com"));

    temp.db
        .with(|conn| {
            let today = util::today();
            // The ladder has a rule at 30 days and one at 60.
            let due = reminders::plan(conn, today)?;
            assert_eq!(due.len(), 1, "only the 30-day rule matches today");
            assert_eq!(due[0].days_to_expiry, 30);
            assert!(due[0].blocked_reason.is_none());

            let tomorrow = reminders::plan(conn, today + chrono::Duration::days(1))?;
            assert!(tomorrow.is_empty(), "nothing is due the day after");
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_reminder_is_sent_once_however_often_the_sweep_runs() {
    let temp = TempDb::new("sweep-once");
    book_expiring_in(&temp, 30, Some("ananya@example.com"));
    let mail = FakeMail::default();

    let first = temp
        .db
        .with_tx(|tx| reminders::sweep(tx, Some(&mail), &NoAlerts, &SweepOptions::live()))
        .unwrap();
    assert_eq!(first.queued, 1);
    assert_eq!(first.sent, 1);
    assert_eq!(mail.recipients(), vec!["ananya@example.com".to_string()]);

    // Three more sweeps on the same day, as if the app restarted repeatedly.
    for _ in 0..3 {
        let again = temp
            .db
            .with_tx(|tx| reminders::sweep(tx, Some(&mail), &NoAlerts, &SweepOptions::live()))
            .unwrap();
        assert_eq!(again.queued, 0);
        assert_eq!(again.sent, 0);
    }
    assert_eq!(mail.count(), 1, "the client is written to exactly once");
}

#[test]
fn a_dry_run_writes_nothing_and_sends_nothing() {
    let temp = TempDb::new("dry-run");
    book_expiring_in(&temp, 30, Some("ananya@example.com"));
    let mail = FakeMail::default();

    let run = temp
        .db
        .with_tx(|tx| {
            reminders::sweep(
                tx,
                Some(&mail),
                &NoAlerts,
                &SweepOptions {
                    today: util::today(),
                    dry_run: true,
                },
            )
        })
        .unwrap();

    assert!(run.dry_run);
    assert_eq!(run.queued, 1, "it still reports what would go out");
    assert_eq!(mail.count(), 0);

    temp.db
        .with(|conn| {
            let logged: i64 =
                conn.query_row("SELECT COUNT(*) FROM notification_log", [], |r| r.get(0))?;
            assert_eq!(logged, 0, "a dry run leaves the outbox empty");
            Ok(())
        })
        .unwrap();
}

#[test]
fn opting_out_and_missing_addresses_are_recorded_not_retried() {
    let temp = TempDb::new("blocked");
    let (client_id, _) = book_expiring_in(&temp, 30, None);
    let mail = FakeMail::default();

    let run = temp
        .db
        .with_tx(|tx| reminders::sweep(tx, Some(&mail), &NoAlerts, &SweepOptions::live()))
        .unwrap();
    assert_eq!(run.skipped, 1);
    assert_eq!(mail.count(), 0);

    temp.db
        .with(|conn| {
            let (status, reason): (String, Option<String>) = conn.query_row(
                "SELECT status, last_error FROM notification_log WHERE client_id = ?1",
                rusqlite::params![client_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            assert_eq!(status, "skipped");
            assert!(reason.unwrap().contains("No email address"));
            Ok(())
        })
        .unwrap();

    // The skip is remembered, so the same client is not raised again tomorrow.
    let second = temp
        .db
        .with_tx(|tx| reminders::sweep(tx, Some(&mail), &NoAlerts, &SweepOptions::live()))
        .unwrap();
    assert_eq!(second.skipped, 0);
}

#[test]
fn a_failed_send_stays_queued_until_it_gives_up() {
    let temp = TempDb::new("retry");
    book_expiring_in(&temp, 30, Some("ananya@example.com"));
    let broken = FakeMail::failing("The server refused the message");

    for attempt in 1..=3 {
        temp.db
            .with_tx(|tx| reminders::sweep(tx, Some(&broken), &NoAlerts, &SweepOptions::live()))
            .unwrap();

        temp.db
            .with(|conn| {
                let (status, attempts): (String, i64) = conn.query_row(
                    "SELECT status, attempts FROM notification_log LIMIT 1",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                assert_eq!(attempts, attempt);
                if attempt < 3 {
                    assert_eq!(status, "queued", "it waits for the next sweep");
                } else {
                    assert_eq!(status, "failed", "after three tries it stops");
                }
                Ok(())
            })
            .unwrap();
    }
}

#[test]
fn the_daily_cap_holds_the_rest_back_for_tomorrow() {
    let temp = TempDb::new("cap");
    let mail = FakeMail::default();

    temp.db
        .with_tx(|tx| {
            settings::put(tx, "daily_send_cap", "2")?;
            settings::put(tx, "digest_enabled", "false")?;
            let insurer_id = insurers::find_or_create(tx, "Star Health and Allied Insurance")?;
            let expiry = util::iso(util::today() + chrono::Duration::days(30));
            for i in 0..5 {
                let mut input = sample_client(&format!("Client {i}"));
                input.email = Some(format!("client{i}@example.com"));
                let client_id = clients::create(tx, &input)?;
                policies::create(
                    tx,
                    &sample_policy(client_id, insurer_id, &format!("SH/2026/{i}"), &expiry),
                )?;
            }
            Ok(())
        })
        .unwrap();

    let run = temp
        .db
        .with_tx(|tx| reminders::sweep(tx, Some(&mail), &NoAlerts, &SweepOptions::live()))
        .unwrap();

    assert_eq!(run.queued, 5, "all five are written to the outbox");
    assert_eq!(run.sent, 2, "only two are sent today");
    assert_eq!(run.held_by_cap, 3);
    assert_eq!(mail.count(), 2);

    temp.db
        .with(|conn| {
            let waiting: i64 = conn.query_row(
                "SELECT COUNT(*) FROM notification_log WHERE status = 'queued'",
                [],
                |r| r.get(0),
            )?;
            assert_eq!(waiting, 3, "the rest keep their place in the queue");
            Ok(())
        })
        .unwrap();
}

#[test]
fn renewing_cancels_the_reminder_still_waiting_to_go_out() {
    let temp = TempDb::new("renew-cancels");
    let (_, policy_id) = book_expiring_in(&temp, 30, Some("ananya@example.com"));

    // Cap of zero leaves the reminder queued rather than sent.
    temp.db
        .with_tx(|tx| settings::put(tx, "daily_send_cap", "0"))
        .unwrap();
    let mail = FakeMail::default();
    temp.db
        .with_tx(|tx| reminders::sweep(tx, Some(&mail), &NoAlerts, &SweepOptions::live()))
        .unwrap();

    temp.db
        .with_tx(|tx| {
            policies::renew(
                tx,
                &RenewalInput {
                    policy_id,
                    // The insurer issues a fresh number for the new year.
                    policy_number: Some("SH/2027/884213".into()),
                    ..Default::default()
                },
            )
        })
        .unwrap();

    temp.db
        .with(|conn| {
            let status: String = conn.query_row(
                "SELECT status FROM notification_log WHERE policy_id = ?1",
                rusqlite::params![policy_id],
                |row| row.get(0),
            )?;
            assert_eq!(
                status, "cancelled",
                "a renewed client should not be chased about expiry"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn templates_fill_in_the_policy_and_refuse_unknown_names() {
    let temp = TempDb::new("templates");
    book_expiring_in(&temp, 30, Some("ananya@example.com"));

    temp.db
        .with(|conn| {
            let provider = reminders::provider_context(conn)?;
            let (policy_id, _) = reminders::sample_policy(conn)?.unwrap();
            let context = reminders::policy_context(conn, policy_id, &provider)?;

            let rendered = templating::render(
                "Dear {{client_name}}, {{policy_number}} with {{insurer_name}} \
                 ends on {{expiry_date}}. Sum insured {{sum_insured}}. — {{provider_name}}",
                &context,
            );
            assert!(rendered.contains("Ananya Sharma"));
            assert!(rendered.contains("SH/2026/884213"));
            assert!(rendered.contains("Star Health"));
            assert!(rendered.contains("₹10,00,000"));
            assert!(rendered.contains("Sunrise Insurance Services"));

            // A name nothing fills leaves a gap rather than braces in the inbox.
            assert_eq!(templating::render("[{{nope}}]", &context), "[]");
            assert_eq!(
                templating::unknown_placeholders("{{client_name}} {{nope}}"),
                vec!["nope".to_string()]
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_client_name_with_an_ampersand_cannot_break_the_message() {
    let temp = TempDb::new("escaping");
    temp.db
        .with_tx(|tx| {
            let mut input = sample_client("Sharma & Sons <Trading>");
            input.email = Some("sharma@example.com".into());
            let client_id = clients::create(tx, &input)?;
            let insurer_id = insurers::find_or_create(tx, "Star Health and Allied Insurance")?;
            let expiry = util::iso(util::today() + chrono::Duration::days(30));
            policies::create(
                tx,
                &sample_policy(client_id, insurer_id, "SH/2026/1", &expiry),
            )?;
            Ok(())
        })
        .unwrap();

    temp.db
        .with(|conn| {
            let provider = reminders::provider_context(conn)?;
            let (policy_id, _) = reminders::sample_policy(conn)?.unwrap();
            let context = reminders::policy_context(conn, policy_id, &provider)?;

            // Names are tidied on the way in, so this checks the escaping
            // rather than the exact capitalisation.
            let html = templating::render("<p>Dear {{client_name}},</p>", &context);
            assert!(html.contains("Sharma &amp; Sons &lt;"), "got: {html}");
            assert!(!html.contains("<Trading"), "raw angle brackets got through");

            // The triple brace is the deliberate way to pass HTML through.
            let mut raw = templating::Context::new();
            raw.set("digest_table", "<table><tr><td>1</td></tr></table>");
            assert!(templating::render("{{{digest_table}}}", &raw).starts_with("<table>"));
            Ok(())
        })
        .unwrap();
}

#[test]
fn documents_are_copied_into_the_book_and_survive_the_policy() {
    let temp = TempDb::new("documents");
    let source = temp.dir.join("schedule.pdf");
    let bytes = b"%PDF-1.7 not really a pdf, but the bytes must come back exactly".to_vec();
    std::fs::write(&source, &bytes).unwrap();

    temp.db
        .with(|conn| {
            let client_id = clients::create(conn, &sample_client("Ananya Rao"))?;
            let insurer_id = insurers::find_or_create(conn, "Star Health")?;
            let policy_id = policies::create(
                conn,
                &sample_policy(client_id, insurer_id, "SH/2026/9", "2027-03-31"),
            )?;

            let id = documents::attach(
                conn,
                &DocumentInput {
                    client_id,
                    policy_id: Some(policy_id),
                    title: None,
                    path: source.to_string_lossy().to_string(),
                },
            )?;

            let listed = documents::list_for_client(conn, client_id)?;
            assert_eq!(listed.len(), 1);
            assert_eq!(
                listed[0].title, "schedule",
                "the file name becomes the title"
            );
            assert_eq!(listed[0].mime_type, "application/pdf");
            assert_eq!(listed[0].size_bytes, bytes.len() as i64);
            assert_eq!(listed[0].policy_number.as_deref(), Some("SH/2026/9"));

            assert_eq!(
                documents::content(conn, id)?,
                bytes,
                "bytes must round trip"
            );

            // The agent's own copy is untouched: this is a copy in, not a move.
            assert!(source.exists());

            let again = documents::attach(
                conn,
                &DocumentInput {
                    client_id,
                    policy_id: None,
                    title: Some("Second go".into()),
                    path: source.to_string_lossy().to_string(),
                },
            );
            assert!(
                matches!(again, Err(crate::error::AppError::Conflict(_))),
                "the same file twice on one client is a mis-click"
            );

            let text = temp.dir.join("notes.txt");
            std::fs::write(&text, "not a scan").unwrap();
            let rejected = documents::attach(
                conn,
                &DocumentInput {
                    client_id,
                    policy_id: None,
                    title: None,
                    path: text.to_string_lossy().to_string(),
                },
            );
            assert!(matches!(
                rejected,
                Err(crate::error::AppError::Validation(_))
            ));

            // Deleting the policy keeps the paperwork on the client.
            policies::delete(conn, policy_id)?;
            let orphaned = documents::list_for_client(conn, client_id)?;
            assert_eq!(orphaned.len(), 1);
            assert_eq!(orphaned[0].policy_id, None);

            documents::delete(conn, id)?;
            assert!(documents::list_for_client(conn, client_id)?.is_empty());
            let blobs: i64 =
                conn.query_row("SELECT COUNT(*) FROM document_contents", [], |row| {
                    row.get(0)
                })?;
            assert_eq!(blobs, 0, "the bytes go with the row");
            Ok(())
        })
        .unwrap();
}

#[test]
fn the_same_file_attached_twice_is_refused_in_words_the_operator_can_act_on() {
    let temp = TempDb::new("documents-duplicate");
    let source = temp.dir.join("schedule.pdf");
    std::fs::write(&source, b"%PDF-1.7 the same schedule, picked twice").unwrap();

    temp.db
        .with(|conn| {
            let client_id = clients::create(conn, &sample_client("Rohit Deshpande"))?;
            let input = DocumentInput {
                client_id,
                policy_id: None,
                title: None,
                path: source.to_string_lossy().to_string(),
            };
            documents::attach(conn, &input)?;

            let message = match documents::attach(conn, &input) {
                Err(crate::error::AppError::Conflict(message)) => message,
                _ => panic!("the same file twice on one client is a mis-click"),
            };
            // The Documents panel prints whatever comes back, so the refusal has
            // to be a sentence about the client's paperwork rather than SQLite
            // explaining its own index.
            assert_eq!(message, "That file is already attached to this client.");
            Ok(())
        })
        .unwrap();
}

#[test]
fn deleting_a_client_takes_their_documents() {
    let temp = TempDb::new("documents-cascade");
    let source = temp.dir.join("proposal.png");
    std::fs::write(&source, b"\x89PNG\r\n\x1a\n pretend image").unwrap();

    temp.db
        .with(|conn| {
            let client_id = clients::create(conn, &sample_client("Vikram Nair"))?;
            documents::attach(
                conn,
                &DocumentInput {
                    client_id,
                    policy_id: None,
                    title: Some("Proposal form".into()),
                    path: source.to_string_lossy().to_string(),
                },
            )?;

            clients::delete(conn, client_id)?;

            let rows: i64 =
                conn.query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))?;
            let blobs: i64 =
                conn.query_row("SELECT COUNT(*) FROM document_contents", [], |row| {
                    row.get(0)
                })?;
            assert_eq!((rows, blobs), (0, 0));
            Ok(())
        })
        .unwrap();
}

#[test]
fn an_export_carries_every_column_and_reads_like_the_screen() {
    let temp = TempDb::new("export-clients");
    temp.db
        .with(|conn| {
            let mut input = sample_client("Ananya Sharma");
            input.email = Some("ananya@example.com".into());
            input.city = Some("Pune".into());
            clients::create(conn, &input)?;

            let rows = clients::list(conn, &ClientFilter::default())?.rows;
            let path = temp.dir.join("clients.csv");
            assert_eq!(exporter::export_clients(&rows, &path)?, 1);

            let text = std::fs::read_to_string(&path).unwrap();
            let mut lines = text.lines();
            let headers: Vec<&str> = lines.next().unwrap().split(',').collect();
            assert_eq!(headers.first(), Some(&"Client code"));
            assert_eq!(headers.last(), Some(&"Notes"));
            assert_eq!(
                headers.len(),
                18,
                "a column added to the export needs a line in the guide too"
            );

            let row = lines.next().unwrap();
            assert!(row.contains("Ananya Sharma"));
            assert!(row.contains("ananya@example.com"));
            assert!(row.contains("Pune"));
            assert!(
                row.contains(",On"),
                "an opt-out reads as words, not as 0 or 1"
            );
            assert!(lines.next().is_none(), "one client, one row");
            Ok(())
        })
        .unwrap();
}

#[test]
fn an_export_refuses_a_format_it_cannot_write() {
    let temp = TempDb::new("export-format");
    temp.db
        .with(|conn| {
            let rows = clients::list(conn, &ClientFilter::default())?.rows;

            let refused = exporter::export_clients(&rows, &temp.dir.join("book.pdf"));
            match refused {
                Err(crate::error::AppError::Validation(message)) => {
                    assert!(
                        message.contains(".xlsx") && message.contains(".csv"),
                        "the refusal says what would work instead: {message}"
                    );
                }
                other => panic!("expected a refusal, got {other:?}"),
            }

            // A spreadsheet is the default, including when the name carries no
            // extension at all.
            let workbook = temp.dir.join("book.xlsx");
            exporter::export_clients(&rows, &workbook)?;
            assert!(std::fs::metadata(&workbook).unwrap().len() > 0);
            exporter::export_clients(&rows, &temp.dir.join("book"))?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_header_finds_its_field_by_name_and_then_by_resemblance() {
    let headers: Vec<String> = [
        "Client Name",
        "Policy No",
        "Policy Expiry Date (DD/MM/YYYY)",
        "Something we do not have a field for",
    ]
    .into_iter()
    .map(String::from)
    .collect();

    let mapping = importer::suggest_mapping(&headers);

    assert_eq!(
        mapping.get("fullName").map(String::as_str),
        Some("Client Name")
    );
    assert_eq!(
        mapping.get("policyNumber").map(String::as_str),
        Some("Policy No")
    );
    assert_eq!(
        mapping.get("expiryDate").map(String::as_str),
        Some("Policy Expiry Date (DD/MM/YYYY)"),
        "a header nobody would spell the same way twice still lands, on resemblance"
    );
    assert!(
        !mapping
            .values()
            .any(|v| v == "Something we do not have a field for"),
        "a column with no field is left for the operator rather than guessed at"
    );

    // Every column is claimed by at most one field, or a mapping would quietly
    // read one column into two.
    let mut claimed: Vec<&String> = mapping.values().collect();
    claimed.sort();
    let before = claimed.len();
    claimed.dedup();
    assert_eq!(claimed.len(), before);
}

#[test]
fn the_blank_template_is_a_file_the_importer_can_read() {
    let temp = TempDb::new("template");
    let path = temp.dir.join("template.xlsx");
    importer::write_template(&path).unwrap();

    let sheet = importer::read_sheet(&path, None).unwrap();
    assert_eq!(sheet.sheet, "Policies");
    assert_eq!(
        sheet.rows.len(),
        1,
        "one filled-in example, showing the shape of a row"
    );

    // The point of handing someone this file is that filling it in and sending
    // it back needs no mapping work, so its own headers must map themselves.
    let mapping = importer::suggest_mapping(&sheet.headers);
    for field in ["fullName", "policyNumber", "insurerName", "expiryDate"] {
        assert!(
            mapping.contains_key(field),
            "the template's own headers do not offer {field}"
        );
    }

    // And the example row has to survive the importer, or the file teaches a
    // format the app then refuses.
    let report = temp
        .db
        .with(|conn| {
            importer::run(
                conn,
                &ImportOptions {
                    path: path.to_string_lossy().to_string(),
                    sheet: None,
                    mapping,
                    default_category: None,
                    update_existing: Some(true),
                    dry_run: Some(true),
                },
            )
        })
        .unwrap();
    assert_eq!(report.policies_inserted, 1);
    assert_eq!(report.clients_created, 1);
    assert_eq!(report.failed, 0);
    assert!(
        report.issues.is_empty(),
        "the example row was not read cleanly: {:?}",
        report.issues
    );
}

#[test]
fn a_page_size_stays_within_what_a_screen_can_draw() {
    assert_eq!(query::paginate(None, None), (1, 50, 50, 0));
    assert_eq!(query::paginate(Some(3), Some(20)), (3, 20, 20, 40));
    assert_eq!(
        query::paginate(Some(0), Some(0)),
        (1, 1, 1, 0),
        "a page of nothing would return nothing however far it was paged"
    );
    assert_eq!(
        query::paginate(Some(1), Some(5_000)),
        (1, 500, 500, 0),
        "and a page big enough to load the whole book is capped"
    );
}

#[test]
fn sorting_can_only_name_a_column_the_code_chose() {
    const ALLOWED: &[(&str, &str)] = &[("name", "c.full_name"), ("city", "c.city")];

    assert_eq!(
        query::order_by(Some("name"), false, ALLOWED, "c.id"),
        " ORDER BY c.full_name ASC"
    );
    assert_eq!(
        query::order_by(Some("city"), true, ALLOWED, "c.id"),
        " ORDER BY c.city DESC"
    );
    assert_eq!(
        query::order_by(None, false, ALLOWED, "c.id"),
        " ORDER BY c.id ASC"
    );

    // The sort key arrives from the interface, so anything not on the list has
    // to fall back rather than reach the SQL text.
    assert_eq!(
        query::order_by(
            Some("c.full_name; DROP TABLE clients"),
            false,
            ALLOWED,
            "c.id"
        ),
        " ORDER BY c.id ASC"
    );
}

#[test]
fn a_filter_drops_a_value_the_code_does_not_know() {
    let mixed = vec![
        "Sent".to_string(),
        "teapot".to_string(),
        " queued ".to_string(),
    ];
    let (clause, values) = query::in_clause("n.status", &mixed, notifications::STATUSES)
        .expect("two of the three are real statuses");
    assert_eq!(clause, "n.status IN (?, ?)");
    assert_eq!(
        values,
        vec![
            rusqlite::types::Value::Text("sent".into()),
            rusqlite::types::Value::Text("queued".into())
        ],
        "case and space are tidied, and the invented one is dropped"
    );

    assert!(
        query::in_clause("n.status", &["teapot".to_string()], notifications::STATUSES).is_none(),
        "with nothing left the filter is dropped rather than matching nothing"
    );
}

#[test]
fn a_search_for_a_percent_sign_looks_for_a_percent_sign() {
    assert_eq!(query::like_pattern("50%"), "%50\\%%");
    assert_eq!(query::like_pattern("a_b"), "%a\\_b%");
    assert_eq!(query::like_pattern("back\\slash"), "%back\\\\slash%");
    assert_eq!(query::like_pattern("  Rohit  "), "%Rohit%");

    // And the escape reaches the query, so a wildcard typed into a search box
    // is looked for rather than obeyed.
    let temp = TempDb::new("search-escape");
    let (client, policy) = book_expiring_in(&temp, 30, Some("ananya@example.com"));
    temp.db
        .with(|conn| {
            let ladder = rules::active(conn)?;
            let today = util::today_iso();
            for (index, subject) in ["Renewal 50% complete", "Renewal 5000 complete"]
                .into_iter()
                .enumerate()
            {
                notifications::queue(
                    conn,
                    &notifications::NewNotification {
                        rule_id: ladder[index].id,
                        policy_id: policy,
                        client_id: client,
                        policy_period: "2027-03-31".into(),
                        audience: "client".into(),
                        channel: "email".into(),
                        to_address: Some("ananya@example.com".into()),
                        subject: subject.into(),
                        body: "<p>Hello</p>".into(),
                        scheduled_for: today.clone(),
                    },
                )?;
            }

            let found = notifications::list(
                conn,
                &NotificationFilter {
                    search: Some("50%".into()),
                    ..Default::default()
                },
            )?;
            assert_eq!(found.total, 1, "the percent sign is text, not a wildcard");
            assert_eq!(
                found.rows[0].subject.as_deref(),
                Some("Renewal 50% complete")
            );
            Ok(())
        })
        .unwrap();
}

fn queue_reminder(
    conn: &rusqlite::Connection,
    rule_id: i64,
    client_id: i64,
    policy_id: i64,
    period: &str,
    scheduled_for: &str,
) -> crate::error::AppResult<Option<i64>> {
    notifications::queue(
        conn,
        &notifications::NewNotification {
            rule_id,
            policy_id,
            client_id,
            policy_period: period.into(),
            audience: "client".into(),
            channel: "email".into(),
            to_address: Some("ananya@example.com".into()),
            subject: "Your policy expires soon".into(),
            body: "<p>Hello</p>".into(),
            scheduled_for: scheduled_for.into(),
        },
    )
}

#[test]
fn a_reminder_is_recorded_once_per_policy_year() {
    let temp = TempDb::new("outbox-once");
    let (client, policy) = book_expiring_in(&temp, 30, Some("ananya@example.com"));

    temp.db
        .with(|conn| {
            let rule = rules::active(conn)?[0].id;
            let today = util::today_iso();

            let first = queue_reminder(conn, rule, client, policy, "2027-03-31", &today)?
                .expect("the first write lands");
            assert!(notifications::already_logged(
                conn,
                rule,
                policy,
                "2027-03-31"
            )?);

            assert_eq!(
                queue_reminder(conn, rule, client, policy, "2027-03-31", &today)?,
                None,
                "one rule writes to one policy year once, however often the sweep runs"
            );
            assert_eq!(notifications::count_by_status(conn, "queued")?, 1);

            // Next year is a different period, so the ladder starts again.
            assert!(queue_reminder(conn, rule, client, policy, "2028-03-31", &today)?.is_some());
            assert_eq!(notifications::count_by_status(conn, "queued")?, 2);

            // The record is what holds the reminder back, so cancelling one does
            // not free the slot for a second attempt at the same year.
            notifications::cancel(conn, first)?;
            assert_eq!(
                queue_reminder(conn, rule, client, policy, "2027-03-31", &today)?,
                None
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn the_outbox_only_moves_the_way_the_screen_allows() {
    let temp = TempDb::new("outbox-moves");
    let (client, policy) = book_expiring_in(&temp, 30, Some("ananya@example.com"));

    temp.db
        .with(|conn| {
            let ladder = rules::active(conn)?;
            let today = util::today_iso();
            let id = queue_reminder(conn, ladder[0].id, client, policy, "2027-03-31", &today)?
                .expect("queued");

            assert!(
                matches!(
                    notifications::requeue(conn, id),
                    Err(crate::error::AppError::Conflict(_))
                ),
                "something already waiting cannot be sent again"
            );

            notifications::cancel(conn, id)?;
            assert!(matches!(
                notifications::cancel(conn, id),
                Err(crate::error::AppError::Conflict(_))
            ));

            notifications::requeue(conn, id)?;
            assert_eq!(notifications::count_by_status(conn, "queued")?, 1);

            notifications::mark_sent(conn, id)?;
            assert!(
                matches!(
                    notifications::requeue(conn, id),
                    Err(crate::error::AppError::Conflict(_))
                ),
                "what has gone to a client is not offered again by mistake"
            );
            assert!(matches!(
                notifications::cancel(conn, id),
                Err(crate::error::AppError::Conflict(_))
            ));

            // A skip is a fact about the book that may be corrected, and a
            // failure is worth another try, so both can go back in the queue.
            let second = queue_reminder(conn, ladder[1].id, client, policy, "2027-03-31", &today)?
                .expect("queued");
            notifications::mark_skipped(conn, second, "No email address")?;
            notifications::requeue(conn, second)?;

            notifications::mark_attempt_failed(conn, second, "Server refused", 1)?;
            assert_eq!(notifications::count_by_status(conn, "failed")?, 1);
            notifications::requeue(conn, second)?;
            let (attempts, error): (i64, Option<String>) = conn.query_row(
                "SELECT attempts, last_error FROM notification_log WHERE id = ?1",
                [second],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            assert_eq!(
                (attempts, error),
                (0, None),
                "trying again starts the attempt count over"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn only_what_is_due_leaves_the_outbox() {
    let temp = TempDb::new("outbox-due");
    let (client, policy) = book_expiring_in(&temp, 30, Some("ananya@example.com"));

    temp.db
        .with(|conn| {
            let ladder = rules::active(conn)?;
            let today = util::today_iso();
            let yesterday = util::iso(util::today() - chrono::Duration::days(1));
            let tomorrow = util::iso(util::today() + chrono::Duration::days(1));

            let waiting =
                queue_reminder(conn, ladder[0].id, client, policy, "2027-03-31", &tomorrow)?
                    .expect("queued");
            let now = queue_reminder(conn, ladder[1].id, client, policy, "2027-03-31", &today)?
                .expect("queued");
            let overdue =
                queue_reminder(conn, ladder[2].id, client, policy, "2027-03-31", &yesterday)?
                    .expect("queued");

            let ids: Vec<i64> = notifications::due(conn, &today, 10)?
                .iter()
                .map(|p| p.id)
                .collect();
            assert_eq!(
                ids,
                vec![overdue, now],
                "a backlog drains oldest first, and nothing goes before its date"
            );
            assert!(!ids.contains(&waiting));

            assert_eq!(
                notifications::due(conn, &today, 1)?.len(),
                1,
                "the daily cap is a limit on what is taken out"
            );

            notifications::cancel(conn, overdue)?;
            let after: Vec<i64> = notifications::due(conn, &today, 10)?
                .iter()
                .map(|p| p.id)
                .collect();
            assert_eq!(after, vec![now], "only what is still queued is due");

            let payload = notifications::due(conn, &today, 10)?.remove(0);
            assert_eq!(payload.client_name, "Ananya Sharma");
            assert_eq!(payload.to_address.as_deref(), Some("ananya@example.com"));
            assert_eq!(payload.subject, "Your policy expires soon");
            Ok(())
        })
        .unwrap();
}

#[test]
fn renewing_clears_only_the_reminders_still_waiting() {
    let temp = TempDb::new("outbox-clear");
    let (client, policy) = book_expiring_in(&temp, 30, Some("ananya@example.com"));

    temp.db
        .with(|conn| {
            let ladder = rules::active(conn)?;
            let today = util::today_iso();
            let waiting = queue_reminder(conn, ladder[0].id, client, policy, "2027-03-31", &today)?
                .expect("queued");
            let gone = queue_reminder(conn, ladder[1].id, client, policy, "2027-03-31", &today)?
                .expect("queued");
            notifications::mark_sent(conn, gone)?;

            let day: String = conn.query_row(
                "SELECT date(sent_at) FROM notification_log WHERE id = ?1",
                [gone],
                |row| row.get(0),
            )?;
            assert_eq!(
                notifications::sent_on(conn, &day)?,
                1,
                "the daily count reads the day a message actually went"
            );

            assert_eq!(notifications::cancel_for_policy(conn, policy)?, 1);
            assert_eq!(notifications::count_by_status(conn, "cancelled")?, 1);
            assert_eq!(
                notifications::count_by_status(conn, "sent")?,
                1,
                "a message already with the client cannot be recalled"
            );

            let reason: Option<String> = conn.query_row(
                "SELECT last_error FROM notification_log WHERE id = ?1",
                [waiting],
                |row| row.get(0),
            )?;
            assert_eq!(reason.as_deref(), Some("The policy was renewed"));

            // The outbox filter drops a status the app does not know rather than
            // matching on it.
            let sent_only = notifications::list(
                conn,
                &NotificationFilter {
                    statuses: Some(vec!["sent".into(), "teapot".into()]),
                    ..Default::default()
                },
            )?;
            assert_eq!(sent_only.total, 1);
            assert_eq!(sent_only.rows[0].id, gone);
            Ok(())
        })
        .unwrap();
}

fn sample_template(name: &str) -> EmailTemplateInput {
    EmailTemplateInput {
        name: name.into(),
        trigger: "expiry_reminder".into(),
        subject: "Your policy expires on {{expiry_date}}".into(),
        body_html: "<p>Dear {{client_name}},</p>".into(),
        is_active: Some(true),
    }
}

fn sample_rule(name: &str, template_id: i64) -> ReminderRuleInput {
    ReminderRuleInput {
        name: name.into(),
        offset_days: 45,
        category: None,
        audience: "client".into(),
        channel: "email".into(),
        template_id: Some(template_id),
        is_active: Some(true),
        sort_order: None,
    }
}

#[test]
fn the_ladder_reads_from_furthest_ahead_to_nearest() {
    let temp = TempDb::new("ladder");
    temp.db
        .with(|conn| {
            let every: Vec<i64> = rules::list(conn)?.iter().map(|r| r.offset_days).collect();
            assert_eq!(
                every,
                vec![60, 30, 15, 7, 1, -7],
                "the settings screen shows the ladder in the order it fires"
            );

            let switched_on: Vec<i64> =
                rules::active(conn)?.iter().map(|r| r.offset_days).collect();
            assert_eq!(
                switched_on,
                vec![60, 30, 15, 7, 1],
                "the chase after expiry is seeded but left off until it is wanted"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_rule_the_form_does_not_place_joins_the_ladder_at_the_end() {
    let temp = TempDb::new("ladder-append");
    temp.db
        .with(|conn| {
            let template = templates::create(conn, &sample_template("Renewal due"))?;
            let seeded: Vec<i64> = rules::list(conn)?.iter().map(|r| r.sort_order).collect();
            let last = *seeded
                .iter()
                .max()
                .expect("the book is seeded with a ladder");

            // The form leaves the placement out, so the core decides it.
            let mut added = sample_rule("45 days before expiry", template);
            added.sort_order = None;
            let id = rules::create(conn, &added)?;

            let placed = rules::list(conn)?
                .into_iter()
                .find(|r| r.id == id)
                .expect("the new rule is on the ladder");
            assert!(
                placed.sort_order > last,
                "a new rule goes below the ones already there, not above them: \
                 {} is not past {last}",
                placed.sort_order
            );

            // Editing it without naming a place leaves it where it was.
            let kept = placed.sort_order;
            let mut renamed = sample_rule("45 days before expiry, renamed", template);
            renamed.sort_order = None;
            rules::update(conn, id, &renamed)?;
            let after = rules::list(conn)?
                .into_iter()
                .find(|r| r.id == id)
                .expect("the rule survives being renamed");
            assert_eq!(
                after.sort_order, kept,
                "an edit does not reshuffle the ladder"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_template_a_rule_still_sends_cannot_be_deleted() {
    let temp = TempDb::new("template-guard");
    temp.db
        .with(|conn| {
            let template = templates::create(conn, &sample_template("Renewal due"))?;
            let spare = templates::create(conn, &sample_template("Renewal due, second try"))?;
            let rule = rules::create(conn, &sample_rule("45 days before expiry", template))?;

            let message = match templates::delete(conn, template) {
                Err(crate::error::AppError::Conflict(message)) => message,
                _ => panic!("a template a rule still sends must not be deletable"),
            };
            assert!(
                message.contains('1'),
                "the refusal counts the rules in the way: {message}"
            );

            // Point the rule at another message and the old one can go.
            rules::update(conn, rule, &sample_rule("45 days before expiry", spare))?;
            templates::delete(conn, template)?;
            assert!(matches!(
                templates::get(conn, template),
                Err(crate::error::AppError::NotFound("Template"))
            ));

            let still_there = rules::list(conn)?
                .into_iter()
                .find(|r| r.id == rule)
                .expect("the rule outlives the message it used to send");
            assert_eq!(still_there.template_id, Some(spare));
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_rule_that_writes_to_a_client_needs_something_to_say() {
    let temp = TempDb::new("rule-validation");
    temp.db
        .with(|conn| {
            let template = templates::create(conn, &sample_template("Renewal due"))?;

            let mut speechless = sample_rule("Nothing to say", template);
            speechless.template_id = None;
            assert!(
                matches!(
                    rules::create(conn, &speechless),
                    Err(crate::error::AppError::Validation(_))
                ),
                "a rule that writes to a client without a message would send an empty email"
            );

            // The digest to the agent is assembled rather than templated, so it
            // is allowed to go without one.
            let mut digest = sample_rule("Provider digest", template);
            digest.audience = "provider".into();
            digest.template_id = None;
            rules::create(conn, &digest)?;

            let mut nowhere = sample_rule("Points nowhere", template);
            nowhere.template_id = Some(9_999);
            assert!(matches!(
                rules::create(conn, &nowhere),
                Err(crate::error::AppError::NotFound("Template"))
            ));

            let mut too_far = sample_rule("Too far out", template);
            too_far.offset_days = 400;
            assert!(matches!(
                rules::create(conn, &too_far),
                Err(crate::error::AppError::Validation(_))
            ));

            let mut odd_channel = sample_rule("Odd channel", template);
            odd_channel.channel = "pigeon".into();
            assert!(matches!(
                rules::create(conn, &odd_channel),
                Err(crate::error::AppError::Validation(_))
            ));

            let mut odd_category = sample_rule("Odd category", template);
            odd_category.category = Some("spaceship".into());
            assert!(matches!(
                rules::create(conn, &odd_category),
                Err(crate::error::AppError::Validation(_))
            ));

            rules::create(conn, &sample_rule("45 days before expiry", template))?;
            assert!(
                matches!(
                    rules::create(conn, &sample_rule("45 days before expiry", template)),
                    Err(crate::error::AppError::Conflict(_))
                ),
                "two rules with one name would be indistinguishable in the list"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn deleting_a_rule_keeps_the_record_of_what_it_sent() {
    let temp = TempDb::new("rule-history");
    let (client_id, policy_id) = book_expiring_in(&temp, 30, Some("ananya@example.com"));

    temp.db
        .with(|conn| {
            let template = templates::active_for_trigger(conn, "expiry_reminder")?
                .expect("the seed leaves an expiry reminder switched on");
            let rule = rules::create(conn, &sample_rule("45 days before expiry", template.id))?;

            notifications::queue(
                conn,
                &notifications::NewNotification {
                    rule_id: rule,
                    policy_id,
                    client_id,
                    policy_period: "2027-03-31".into(),
                    audience: "client".into(),
                    channel: "email".into(),
                    to_address: Some("ananya@example.com".into()),
                    subject: "Your policy expires soon".into(),
                    body: "<p>Hello</p>".into(),
                    scheduled_for: util::today_iso(),
                },
            )?;

            rules::delete(conn, rule)?;

            // What was sent to a client is a record of the agency's dealings
            // with them, so changing the ladder must not erase it.
            let kept: i64 = conn.query_row("SELECT COUNT(*) FROM notification_log", [], |row| {
                row.get(0)
            })?;
            assert_eq!(kept, 1);
            let orphaned: Option<i64> =
                conn.query_row("SELECT rule_id FROM notification_log", [], |row| row.get(0))?;
            assert_eq!(
                orphaned, None,
                "it simply stops pointing at a rule that no longer exists"
            );

            assert!(matches!(
                rules::delete(conn, rule),
                Err(crate::error::AppError::NotFound("Reminder rule"))
            ));
            Ok(())
        })
        .unwrap();
}

#[test]
fn the_plain_text_part_keeps_the_shape_of_the_message() {
    let html = "<div><p>Dear Ananya,</p><p>Your policy expires on <strong>31/03/2027</strong>.</p>\
                <table><tr><td>Premium</td><td>&#39;24,500&#39;</td></tr></table>\
                <p>Regards,<br />Sunrise</p></div>";
    let text = mail::to_plain_text(html);

    assert!(text.contains("Dear Ananya,"));
    assert!(text.contains("Your policy expires on 31/03/2027."));
    assert!(text.contains("Premium\t'24,500'"));
    assert!(!text.contains('<'), "no markup survives into the text part");
    assert!(
        !text.contains("\n\n\n"),
        "nested tags should not leave a run of blank lines"
    );
}

/// The single-instance guard hands a second launch to the copy already running,
/// and that copy always brings its window forward — which needs a window, and so
/// is not reachable from here. What is reachable is the reading of the flag the
/// two halves disagree about: the autostart plugin starts the app at login with
/// `--background` and it stays in the tray, while a launch someone made
/// themselves has to arrive on screen. Read that flag too loosely and a login at
/// the wrong moment leaves an operator watching nothing happen.
#[test]
fn only_the_login_item_starts_the_app_into_the_tray() {
    let launch = |args: &[&str]| {
        crate::starts_hidden(args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>())
    };

    assert!(launch(&["stayinsured", "--background"]));
    assert!(
        !launch(&["stayinsured"]),
        "a launch with nothing to say is someone opening the app"
    );

    // The OS decides where in the command line its argument goes, so the flag is
    // looked for rather than expected in a position.
    assert!(launch(&["stayinsured", "--other", "--background"]));

    // A whole argument, not a resemblance: neither of these is the login item.
    assert!(!launch(&["stayinsured", "--background-check"]));
    assert!(!launch(&["stayinsured", "--no-background"]));
    assert!(!launch(&["stayinsured", "background"]));
}
