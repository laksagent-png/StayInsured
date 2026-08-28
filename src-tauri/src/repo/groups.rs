//! Groups: a named folder of clients, and the referrer who introduced them.
//!
//! This is the deliberate opposite of `relations.rs`. A family is not stored
//! anywhere — it is whoever the edges reach, a person is in several at once, and
//! the operations on it stop one step out because it has no edge of its own to
//! stop at. A group has that edge. It is named, entered on purpose, holds a
//! client at a time, and can be listed, summed, archived and deleted as itself.
//!
//! The referrer is held apart from the membership. Whoever brought the group in
//! is a client the agency deals with, but they are not thereby part of the book
//! the group represents: the rollups sum the members, and the group archive
//! moves the members, so an introducer who placed ten firms is not archived
//! along with them and their own policies are not counted as the group's.

use rusqlite::{params, params_from_iter, types::Value, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{blank_to_none, Group, GroupFilter, GroupInput, Page, GROUP_COLUMNS};
use crate::query::{self, Conditions};

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

/// The group's book, summed over its members. The referrer contributes nothing
/// unless they are also in the group, which is the point of holding headship and
/// membership in separate columns.
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

    // Headship read from the referrer's end. Their page needs the groups they
    // brought in, and the group list already knows how to answer that.
    if let Some(head) = filter.head_client_id {
        c.add("g.head_client_id = ?", Value::Integer(head));
    }

    // A small table, so a LIKE scan is the right tool and there is no FTS index
    // to keep in step. The referrer's name is searched too: an operator looking
    // for "the firms Mehta brought us" knows the introducer, not the folder.
    if let Some(search) = blank_to_none(filter.search.clone()) {
        let pattern = query::like_pattern(&search);
        c.add_many(
            "(g.name LIKE ? ESCAPE '\\' OR g.group_code LIKE ? ESCAPE '\\' \
              OR EXISTS (SELECT 1 FROM clients h WHERE h.id = g.head_client_id \
                           AND h.full_name LIKE ? ESCAPE '\\'))"
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

/// A group names the client who introduced it. That is what a group head is, so
/// a group opened without one is not a group with a blank field — it is a
/// referral nobody recorded, and the book is the only place that record exists.
///
/// The column is still nullable, because deleting the referrer must leave the
/// group standing. Editing such a group asks for the new referrer by name.
fn validate(conn: &Connection, input: &GroupInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::validation("Group name is required"));
    }
    match input.head_client_id {
        Some(head) => {
            super::clients::get(conn, head).map_err(|_| {
                AppError::validation("The group head named here is not a client in the book")
            })?;
        }
        None => {
            return Err(AppError::validation(
                "A group needs a group head — the client who referred it",
            ));
        }
    }
    Ok(())
}

pub fn create(conn: &Connection, input: &GroupInput) -> AppResult<i64> {
    validate(conn, input)?;

    let code = match blank_to_none(input.group_code.clone()) {
        Some(code) => code,
        None => next_group_code(conn)?,
    };

    conn.execute(
        "INSERT INTO client_groups (group_code, name, head_client_id, notes) \
         VALUES (?1, ?2, ?3, ?4)",
        params![
            code,
            input.name.trim(),
            input.head_client_id,
            blank_to_none(input.notes.clone()),
        ],
    )
    .map_err(map_unique_error)?;

    Ok(conn.last_insert_rowid())
}

/// The importer's door into the same table, matching on the name and opening a
/// group when the book has none by that name.
///
/// `create` refuses a group with no head, because a group is a referral and this
/// book is the only place that referral is written down. A spreadsheet is the one
/// caller that can honestly say it does not know: it carries the grouping — which
/// companies file together — and carries nothing at all about who introduced
/// them. So this leaves the head NULL, which is not a new state to explain. It is
/// exactly what a group becomes when its referrer is deleted, and the group page
/// already meets it by asking for a new referrer by name. Refusing the row
/// instead would throw away the grouping the sheet does know in order to protect
/// a fact it was never going to carry.
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
        "INSERT INTO client_groups (group_code, name, head_client_id) VALUES (?1, ?2, NULL)",
        params![code, trimmed],
    )
    .map_err(map_unique_error)?;

    Ok(conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: &GroupInput) -> AppResult<()> {
    validate(conn, input)?;

    let changed = conn
        .execute(
            "UPDATE client_groups SET name = ?2, head_client_id = ?3, notes = ?4, \
                 group_code = COALESCE(?5, group_code) \
             WHERE id = ?1",
            params![
                id,
                input.name.trim(),
                input.head_client_id,
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
/// It moves the members and stops. The referrer is not in the group unless they
/// joined it, and putting away a book they introduced is no reason to put away
/// the person who introduced it. Unlike the family archive this needs no depth
/// limit: the group row says exactly who is in it, which is the whole reason for
/// keeping one.
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
