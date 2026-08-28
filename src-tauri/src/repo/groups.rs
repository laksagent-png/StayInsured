//! Groups: a named folder of clients, and the contact who introduced them.
//!
//! This is the deliberate opposite of `relations.rs`. A family is not stored
//! anywhere — it is whoever the edges reach, a person is in several at once, and
//! the operations on it stop one step out because it has no edge of its own to
//! stop at. A group has that edge. It is named, entered on purpose, holds a
//! client at a time, and can be listed, summed, archived and deleted as itself.
//!
//! The head is not a client. Whoever brought the group in is a broker, an HR
//! manager or an accountant — somebody the agency rings and never insures — so
//! their name and contact details are written on the group rather than opened
//! as a client record nobody will ever sell a policy to. Nothing about them
//! reaches the book: the rollups sum the members, the archive moves the
//! members, and a client who happens to be an introducer is only ever a client.

use rusqlite::{params, params_from_iter, types::Value, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{blank_to_none, Group, GroupFilter, GroupInput, Page, GROUP_COLUMNS};
use crate::query::{self, Conditions};
use crate::util;

const SORTABLE: &[(&str, &str)] = &[
    ("name", "g.name"),
    ("code", "g.group_code"),
    ("members", "members"),
    ("policies", "total_policies"),
    ("premium", "premium_under_management"),
    ("nextExpiry", "next_expiry"),
    ("created", "g.created_at"),
    ("updated", "g.updated_at"),
];

/// The group's book, summed over its members. The head contributes nothing to
/// it, because a head is a name and a phone number rather than somebody who
/// holds policies.
const DERIVED: &str = "(SELECT COUNT(*) FROM clients c WHERE c.group_id = g.id) AS members, \
     (SELECT COUNT(*) FROM policies p JOIN clients c ON c.id = p.client_id \
        WHERE c.group_id = g.id AND p.status = 'active') AS active_policies, \
     (SELECT COUNT(*) FROM policies p JOIN clients c ON c.id = p.client_id \
        WHERE c.group_id = g.id) AS total_policies, \
     (SELECT IFNULL(SUM(p.premium_amount), 0) FROM policies p JOIN clients c ON c.id = p.client_id \
        WHERE c.group_id = g.id AND p.status = 'active') AS premium_under_management, \
     (SELECT MIN(p.expiry_date) FROM policies p JOIN clients c ON c.id = p.client_id \
        WHERE c.group_id = g.id AND p.expiry_date >= date('now', 'localtime')) AS next_expiry";

fn build_conditions(filter: &GroupFilter) -> Conditions {
    let mut c = Conditions::new();

    if !filter.include_archived.unwrap_or(false) {
        c.add_raw("g.is_archived = 0");
    }

    // A small table, so a LIKE scan is the right tool and there is no FTS index
    // to keep in step. The head's name is searched too: an operator looking for
    // "the firms Mehta brought us" knows the introducer, not the folder.
    if let Some(search) = blank_to_none(filter.search.clone()) {
        let pattern = query::like_pattern(&search);
        c.add_many(
            "(g.name LIKE ? ESCAPE '\\' OR g.group_code LIKE ? ESCAPE '\\' \
              OR g.head_name LIKE ? ESCAPE '\\')"
                .into(),
            vec![
                Value::Text(pattern.clone()),
                Value::Text(pattern.clone()),
                Value::Text(pattern),
            ],
        );
    }

    c
}

pub fn list(conn: &Connection, filter: &GroupFilter) -> AppResult<Page<Group>> {
    let conditions = build_conditions(filter);
    let where_sql = conditions.where_sql();

    let total = super::count(
        conn,
        &format!("SELECT COUNT(*) FROM client_groups g{where_sql}"),
        conditions.params(),
    )?;

    let (page, page_size, limit, offset) = query::paginate(filter.page, filter.page_size);
    let order = query::order_by(
        filter.sort.as_deref(),
        filter.descending.unwrap_or(false),
        SORTABLE,
        "g.name",
    );

    let sql = format!(
        "SELECT {GROUP_COLUMNS}, {DERIVED} FROM client_groups g{where_sql}{order} LIMIT ? OFFSET ?"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(
            params_from_iter(conditions.params_with([limit, offset])),
            Group::from_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(Page {
        rows,
        total,
        page,
        page_size,
    })
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Group> {
    let sql = format!("SELECT {GROUP_COLUMNS}, {DERIVED} FROM client_groups g WHERE g.id = ?");
    conn.query_row(&sql, params![id], Group::from_row)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound("Group"),
            other => other.into(),
        })
}

/// `GR-00001` upward, allocated the way client codes are so that the two read as
/// one book rather than as two numbering schemes that happen to share a screen.
pub fn next_group_code(conn: &Connection) -> AppResult<String> {
    let next: i64 = conn.query_row(
        "SELECT IFNULL(MAX(CAST(substr(group_code, 4) AS INTEGER)), 0) + 1 \
         FROM client_groups WHERE group_code GLOB 'GR-[0-9]*'",
        [],
        |row| row.get(0),
    )?;
    Ok(format!("GR-{next:05}"))
}

/// Only the name is asked for. A group is a filing arrangement first and a
/// referral second — the agent knows which firms file together long before they
/// can always say who introduced them — so the head is four boxes that may all
/// be left empty.
///
/// The email is the one head field that can be wrong rather than merely absent,
/// and it is held to the same shape a client's is so that a group cannot carry
/// an address the mailer will later choke on.
fn validate(input: &GroupInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::validation("Group name is required"));
    }
    if let Some(email) = blank_to_none(input.head_email.clone()) {
        if !util::looks_like_email(&email) {
            return Err(AppError::validation(
                "The group head's email is not an address",
            ));
        }
    }
    Ok(())
}

pub fn create(conn: &Connection, input: &GroupInput) -> AppResult<i64> {
    validate(input)?;

    let code = match blank_to_none(input.group_code.clone()) {
        Some(code) => code,
        None => next_group_code(conn)?,
    };

    conn.execute(
        "INSERT INTO client_groups \
             (group_code, name, head_name, head_designation, head_phone, head_email, notes) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            code,
            input.name.trim(),
            blank_to_none(input.head_name.clone()).map(|n| util::tidy_name(&n)),
            blank_to_none(input.head_designation.clone()),
            input.head_phone.as_deref().and_then(util::normalise_phone),
            blank_to_none(input.head_email.clone()),
            blank_to_none(input.notes.clone()),
        ],
    )
    .map_err(map_unique_error)?;

    Ok(conn.last_insert_rowid())
}

/// The importer's door into the same table, matching on the name and opening a
/// group when the book has none by that name.
///
/// A spreadsheet carries the grouping — which companies file together — and
/// carries nothing at all about who introduced them, so the group it opens has
/// a code, a name and a blank head. That is an ordinary group rather than a
/// half-made one, and the group screen fills the head in whenever the agent
/// learns it.
pub fn find_or_create_by_name(conn: &Connection, name: &str) -> AppResult<i64> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("Group name is required"));
    }

    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM client_groups WHERE lower(name) = lower(?1)",
            params![trimmed],
            |row| row.get(0),
        )
        .ok();
    if let Some(id) = existing {
        return Ok(id);
    }

    let code = next_group_code(conn)?;
    conn.execute(
        "INSERT INTO client_groups (group_code, name) VALUES (?1, ?2)",
        params![code, trimmed],
    )
    .map_err(map_unique_error)?;

    Ok(conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: &GroupInput) -> AppResult<()> {
    validate(input)?;

    let changed = conn
        .execute(
            "UPDATE client_groups SET name = ?2, head_name = ?3, head_designation = ?4, \
                 head_phone = ?5, head_email = ?6, notes = ?7, \
                 group_code = COALESCE(?8, group_code) \
             WHERE id = ?1",
            params![
                id,
                input.name.trim(),
                blank_to_none(input.head_name.clone()).map(|n| util::tidy_name(&n)),
                blank_to_none(input.head_designation.clone()),
                input.head_phone.as_deref().and_then(util::normalise_phone),
                blank_to_none(input.head_email.clone()),
                blank_to_none(input.notes.clone()),
                blank_to_none(input.group_code.clone()),
            ],
        )
        .map_err(map_unique_error)?;

    if changed == 0 {
        return Err(AppError::NotFound("Group"));
    }
    Ok(())
}

/// Archives or restores the group and every client in it, answering with how
/// many clients it moved.
///
/// It moves the members and stops. The head is not a client, so putting away a
/// book somebody introduced has nothing of theirs to reach. Unlike the family
/// archive this needs no depth limit: the group row says exactly who is in it,
/// which is the whole reason for keeping one.
pub fn set_archived(conn: &Connection, id: i64, archived: bool) -> AppResult<usize> {
    get(conn, id)?;

    conn.execute(
        "UPDATE client_groups SET is_archived = ?2 WHERE id = ?1",
        params![id, archived as i64],
    )?;

    let moved = conn.execute(
        "UPDATE clients SET is_archived = ?2 WHERE group_id = ?1 AND is_archived <> ?2",
        params![id, archived as i64],
    )?;
    Ok(moved)
}

/// Removes the group and answers with how many clients it let go.
///
/// The clients stay. A group is a folder: emptying the filing cabinet of one
/// folder does not empty it of the papers, and every company in a group is a
/// client holding its own policies. `clients.group_id` is `ON DELETE SET NULL`,
/// so the release happens in the schema rather than in a loop that could stop
/// halfway.
pub fn delete(conn: &Connection, id: i64) -> AppResult<usize> {
    let released: i64 = conn.query_row(
        "SELECT COUNT(*) FROM clients WHERE group_id = ?1",
        params![id],
        |row| row.get(0),
    )?;

    let changed = conn.execute("DELETE FROM client_groups WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound("Group"));
    }
    Ok(released as usize)
}

/// Puts a client into a group, or takes them out of one with `None`.
///
/// This is the only place membership is said out loud. `clients::update`
/// coalesces `group_id` so that a client form which knows nothing about groups
/// cannot empty one by saving a name change, which leaves exactly one operation
/// that can move somebody — and it is the one the group screens call.
pub fn set_client_group(conn: &Connection, client_id: i64, group_id: Option<i64>) -> AppResult<()> {
    super::clients::get(conn, client_id)?;
    if let Some(group) = group_id {
        get(conn, group)?;
    }

    conn.execute(
        "UPDATE clients SET group_id = ?2 WHERE id = ?1",
        params![client_id, group_id],
    )?;
    Ok(())
}

fn map_unique_error(err: rusqlite::Error) -> AppError {
    match &err {
        rusqlite::Error::SqliteFailure(e, Some(msg))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            if super::constraint_names(msg, &["group_code"]) {
                AppError::Conflict("That group code is already in use".into())
            } else {
                AppError::Conflict("A group with that name already exists".into())
            }
        }
        _ => err.into(),
    }
}
