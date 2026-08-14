//! Exercises the data layer without a window: schema, renewal chains, status
//! transitions, spreadsheet import and export.

use std::path::PathBuf;
use std::sync::Mutex;

use crate::db::Database;
use crate::importer::{self, ImportOptions};
use crate::mail::{self, Outgoing};
use crate::models::{
    ClientFilter, ClientInput, DocumentInput, MemberInput, PolicyFilter, PolicyInput, RenewalInput,
};
use crate::reminders::{self, NoAlerts, SweepOptions};
use crate::repo::{clients, dashboard, documents, insurers, members, policies, products, settings};
use crate::templating;
use crate::util;
use crate::vault::Vault;

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
fn deleting_a_client_takes_their_policies_and_members_with_them() {
    let temp = TempDb::new("client-cascade");
    temp.db
        .with(|conn| {
            let client = clients::create(conn, &sample_client("Neha Kulkarni"))?;
            let insurer = insurers::find_or_create(conn, "Star Health")?;
            let policy = policies::create(
                conn,
                &sample_policy(client, insurer, "SH/2026/77", "2027-03-31"),
            )?;
            let member = members::create(
                conn,
                &MemberInput {
                    client_id: client,
                    full_name: "Aarav Kulkarni".into(),
                    relationship: Some("son".into()),
                    date_of_birth: None,
                    gender: None,
                    notes: None,
                },
            )?;
            policies::set_members(conn, policy, &[member])?;

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
            let members_left: i64 = conn.query_row(
                "SELECT COUNT(*) FROM insured_members WHERE client_id = ?1",
                [client],
                |row| row.get(0),
            )?;
            let links_left: i64 =
                conn.query_row("SELECT COUNT(*) FROM policy_members", [], |row| row.get(0))?;
            assert_eq!(
                (policies_left, members_left, links_left),
                (0, 0, 0),
                "policies, members and the links between them all go"
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
            Ok(())
        })
        .unwrap();
}

#[test]
fn members_attach_only_to_their_own_client() {
    let temp = TempDb::new("members");
    temp.db
        .with(|conn| {
            let owner = clients::create(conn, &sample_client("Owner One"))?;
            let stranger = clients::create(conn, &sample_client("Stranger Two"))?;
            let insurer = insurers::find_or_create(conn, "Niva Bupa")?;
            let policy =
                policies::create(conn, &sample_policy(owner, insurer, "M-1", "2027-06-30"))?;

            let mine = members::find_or_create(conn, owner, "Spouse Name", Some("wife"))?;
            let theirs = members::find_or_create(conn, stranger, "Other Person", None)?;

            policies::set_members(conn, policy, &[mine, theirs])?;
            let attached = policies::members_of(conn, policy)?;
            assert_eq!(
                attached,
                vec![mine],
                "a member from another client must be ignored"
            );

            let listed = members::list_for_client(conn, owner)?;
            assert_eq!(listed.len(), 1);
            assert_eq!(listed[0].relationship, "spouse");
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

            assert_eq!(members::list_for_client(conn, row.client_id)?.len(), 2);
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
            assert_eq!((clients_total, policies_total), (2, 2));
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
        util::default_expiry("2026-04-01").as_deref(),
        Some("2027-03-31")
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
