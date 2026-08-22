//! Family as edges between clients.
//!
//! There is no family table and no family id. A family is the set of clients
//! reachable from one of them by following `client_relations` in either
//! direction, which is what lets a person belong to more than one — a married
//! man is in his wife and children's family and in his parents' — without
//! anything having to choose between them, and what lets the record read the
//! same walked from any member.
//!
//! The walk is done here rather than in a recursive CTE. Both editions must
//! agree, the older SQLite behind the Windows 7 build is not a good place to
//! rest a graph traversal, and a visited set in code cannot loop forever the way
//! a recursive query whose key includes the depth can.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{Family, FamilyEdge, FamilyMember, RelationInput, Relative};
use crate::util;

/// How far a family may be walked. An agency's book is not a genealogy, and a
/// mistaken edge between two families should not turn one screen into the whole
/// client list.
const MAX_DEPTH: usize = 12;

const PERSON: &str = "c.id AS client_id, c.client_code, c.full_name, c.date_of_birth, c.gender, \
     c.is_archived, \
     (SELECT COUNT(*) FROM policies p WHERE p.client_id = c.id) AS own_policies";

/// Everyone directly related to this client, both directions of the edge, with
/// `outgoing` saying which way each one is stored so the interface can read the
/// stored word aloud rather than guess its opposite.
///
/// Ordered so that a spouse comes first and children before parents, which is
/// the order a family is described in.
pub fn list_for_client(conn: &Connection, client_id: i64) -> AppResult<Vec<Relative>> {
    // The union is wrapped because a compound SELECT may only be ordered by its
    // result columns, and the order a family is described in is an expression.
    let sql = "SELECT client_id, client_code, full_name, relationship, outgoing, date_of_birth, \
                      gender, is_archived, own_policies, notes \
               FROM (SELECT c.id AS client_id, c.client_code AS client_code, \
                            c.full_name AS full_name, r.relationship AS relationship, \
                            1 AS outgoing, c.date_of_birth AS date_of_birth, \
                            c.gender AS gender, c.is_archived AS is_archived, \
                            (SELECT COUNT(*) FROM policies p WHERE p.client_id = c.id) \
                              AS own_policies, \
                            c.notes AS notes \
                     FROM client_relations r JOIN clients c ON c.id = r.related_client_id \
                     WHERE r.client_id = ?1 \
                     UNION ALL \
                     SELECT c.id, c.client_code, c.full_name, r.relationship, 0, \
                            c.date_of_birth, c.gender, c.is_archived, \
                            (SELECT COUNT(*) FROM policies p WHERE p.client_id = c.id), \
                            c.notes \
                     FROM client_relations r JOIN clients c ON c.id = r.client_id \
                     WHERE r.related_client_id = ?1) \
               ORDER BY CASE relationship \
                          WHEN 'spouse' THEN 0 WHEN 'son' THEN 1 WHEN 'daughter' THEN 1 \
                          WHEN 'father' THEN 2 WHEN 'mother' THEN 2 ELSE 3 END, full_name";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(params![client_id], Relative::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// The whole family around a client: every person reachable, and every edge
/// between the people found. `steps` on each member is the shortest walk from the
/// client asked about, so the interface can lay out the tree without repeating
/// the traversal.
pub fn family(conn: &Connection, client_id: i64) -> AppResult<Family> {
    // Confirms the client exists, so an unknown id is a NotFound rather than an
    // empty family.
    super::clients::get(conn, client_id)?;

    let mut steps: HashMap<i64, i64> = HashMap::from([(client_id, 0)]);
    let mut frontier = vec![client_id];

    let mut stmt = conn.prepare(
        "SELECT related_client_id FROM client_relations WHERE client_id = ?1 \
         UNION \
         SELECT client_id FROM client_relations WHERE related_client_id = ?1",
    )?;

    for depth in 1..=MAX_DEPTH {
        let mut next = Vec::new();
        for person in frontier.drain(..) {
            let neighbours = stmt
                .query_map(params![person], |row| row.get::<_, i64>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for neighbour in neighbours {
                if steps.contains_key(&neighbour) {
                    continue;
                }
                steps.insert(neighbour, depth as i64);
                next.push(neighbour);
            }
        }
        if next.is_empty() {
            break;
        }
        frontier = next;
    }

    let ids: HashSet<i64> = steps.keys().copied().collect();
    let mut members = Vec::with_capacity(ids.len());
    let person_sql = format!("SELECT {PERSON} FROM clients c WHERE c.id = ?1");
    let mut person_stmt = conn.prepare(&person_sql)?;
    for (id, walked) in &steps {
        let mut member = person_stmt.query_row(params![id], FamilyMember::from_row)?;
        member.steps = *walked;
        members.push(member);
    }
    members.sort_by(|a, b| {
        a.steps
            .cmp(&b.steps)
            .then_with(|| a.full_name.cmp(&b.full_name))
    });

    // Every edge among the people found, including the ones that close a loop —
    // a couple who are also each other's cousins is one family with two ways
    // through it, and dropping the second edge would draw a tree the book does
    // not hold.
    let mut edge_stmt = conn.prepare(
        "SELECT client_id, related_client_id, relationship FROM client_relations \
         ORDER BY client_id, related_client_id",
    )?;
    let edges = edge_stmt
        .query_map([], FamilyEdge::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .filter(|e| ids.contains(&e.client_id) && ids.contains(&e.related_client_id))
        .collect();

    Ok(Family { members, edges })
}

/// Records how two clients are related, or corrects the word on an edge that
/// already exists in either direction.
pub fn link(conn: &Connection, input: &RelationInput) -> AppResult<()> {
    if input.client_id == input.related_client_id {
        return Err(AppError::validation(
            "A client cannot be related to themselves",
        ));
    }
    // Strict here, tolerant in the importer below. A word arriving from the
    // interface came from a fixed list, so an unknown one is a bug worth a
    // message rather than something to quietly file under "other".
    let relationship = input.relationship.trim().to_lowercase();
    if !util::RELATIONSHIPS.contains(&relationship.as_str()) {
        return Err(AppError::validation(format!(
            "\"{}\" is not a relationship this book records",
            input.relationship.trim()
        )));
    }
    let relationship = relationship.as_str();

    for id in [input.client_id, input.related_client_id] {
        super::clients::get(conn, id)?;
    }

    // The pair is what is unique, not the direction. Somebody adding "father" on
    // the son's page when the father's page already says "son" is describing the
    // edge that is there, and would otherwise get a second row saying the
    // opposite of the first.
    let existing: Option<(i64, i64)> = conn
        .query_row(
            "SELECT client_id, related_client_id FROM client_relations \
             WHERE (client_id = ?1 AND related_client_id = ?2) \
                OR (client_id = ?2 AND related_client_id = ?1)",
            params![input.client_id, input.related_client_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    if let Some((holder, related)) = existing {
        // Rewriting the stored direction as well as the word, so that the edge
        // says what the operator just said on the page they said it on.
        conn.execute(
            "DELETE FROM client_relations WHERE client_id = ?1 AND related_client_id = ?2",
            params![holder, related],
        )?;
    }

    reject_ancestry_loop(conn, input.client_id, input.related_client_id, relationship)?;

    conn.execute(
        "INSERT INTO client_relations (client_id, related_client_id, relationship) \
         VALUES (?1, ?2, ?3)",
        params![input.client_id, input.related_client_id, relationship],
    )?;
    Ok(())
}

/// Removes the edge between two clients, whichever way round it is stored. The
/// people stay: they are clients, and one of them holding a policy is ordinary.
pub fn unlink(conn: &Connection, client_id: i64, related_client_id: i64) -> AppResult<()> {
    let changed = conn.execute(
        "DELETE FROM client_relations \
         WHERE (client_id = ?1 AND related_client_id = ?2) \
            OR (client_id = ?2 AND related_client_id = ?1)",
        params![client_id, related_client_id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("Relationship"));
    }
    Ok(())
}

/// The client ids directly related to this one, either direction. What the
/// family-wide archive and the family delete act on: one step out, so that
/// recording an in-law never widens what either of them reaches.
pub fn immediate_ids(conn: &Connection, client_id: i64) -> AppResult<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT related_client_id FROM client_relations WHERE client_id = ?1 \
         UNION \
         SELECT client_id FROM client_relations WHERE related_client_id = ?1",
    )?;
    let rows = stmt
        .query_map(params![client_id], |row| row.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Used by the importer, which sees a name in a "members covered" column rather
/// than an id. Looks among the people already related to this client, then among
/// clients of that name, and only then creates one.
pub fn find_or_create_relative(
    conn: &Connection,
    client_id: i64,
    name: &str,
    relationship: Option<&str>,
) -> AppResult<i64> {
    let tidy = util::tidy_name(name);

    // The holder themselves, named in their own cover list. This is what the
    // 'self' member row used to be.
    let holder_name: String = conn.query_row(
        "SELECT full_name FROM clients WHERE id = ?1",
        params![client_id],
        |row| row.get(0),
    )?;
    if holder_name.eq_ignore_ascii_case(&tidy) || util::is_self_relationship(relationship) {
        return Ok(client_id);
    }

    // Already in this family. Matching here first is what keeps a second import
    // of the same spreadsheet from adding a second Priya.
    let related: Option<i64> = conn
        .query_row(
            "SELECT c.id FROM client_relations r JOIN clients c ON c.id = r.related_client_id \
             WHERE r.client_id = ?1 AND lower(c.full_name) = lower(?2) \
             UNION \
             SELECT c.id FROM client_relations r JOIN clients c ON c.id = r.client_id \
             WHERE r.related_client_id = ?1 AND lower(c.full_name) = lower(?2) \
             LIMIT 1",
            params![client_id, tidy],
            |row| row.get(0),
        )
        .ok();
    if let Some(id) = related {
        // The pair stands either way. Where the file states the relationship,
        // recording it is what lets a re-import correct a book whose families
        // came in as `other` before anyone was reading the word beside the name.
        // Silence leaves the existing word alone rather than flattening it.
        if let Some(word) = relationship.filter(|r| !util::is_self_relationship(Some(r))) {
            link(
                conn,
                &RelationInput {
                    client_id,
                    related_client_id: id,
                    relationship: util::normalise_relationship(word),
                },
            )?;
        }
        return Ok(id);
    }

    // In the book but not yet tied to this family, and unambiguously so. The
    // same rule migration 005 used: one match is a person, two are two people.
    let matches: Vec<i64> = {
        let mut stmt = conn.prepare(
            "SELECT id FROM clients WHERE lower(full_name) = lower(?1) ORDER BY id LIMIT 2",
        )?;
        let found = stmt
            .query_map(params![tidy], |row| row.get::<_, i64>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        found
    };

    let id = if matches.len() == 1 {
        matches[0]
    } else {
        create_relative(conn, client_id, &tidy)?
    };

    link(
        conn,
        &RelationInput {
            client_id,
            related_client_id: id,
            relationship: relationship
                .map(util::normalise_relationship)
                .unwrap_or_else(|| "other".into()),
        },
    )?;
    Ok(id)
}

/// Opens a client for somebody named only as a life on a policy, giving them the
/// household's address the way migration 005 did: they live where the
/// policyholder lives, and the client list filters on it.
fn create_relative(conn: &Connection, client_id: i64, tidy_name: &str) -> AppResult<i64> {
    let code = super::clients::next_client_code(conn)?;
    conn.execute(
        "INSERT INTO clients (client_code, full_name, address_line1, address_line2, city, \
             state, pincode, preferred_language) \
         SELECT ?2, ?3, address_line1, address_line2, city, state, pincode, preferred_language \
         FROM clients WHERE id = ?1",
        params![client_id, code, tidy_name],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Refuses an edge that would make somebody their own ancestor. Parent and child
/// edges are the ones with a direction that means something up and down a family,
/// so they are the ones that can contradict themselves; a spouse or sibling edge
/// closing a loop is a family with two ways through it, not a broken one.
fn reject_ancestry_loop(
    conn: &Connection,
    client_id: i64,
    related_client_id: i64,
    relationship: &str,
) -> AppResult<()> {
    let (ancestor, descendant) = match relationship {
        // "related is the son of client": client is above.
        "son" | "daughter" => (client_id, related_client_id),
        // "related is the father of client": related is above.
        "father" | "mother" => (related_client_id, client_id),
        _ => return Ok(()),
    };

    // Walking up from the proposed ancestor: if the descendant is already above
    // them, the new edge would close the loop.
    let mut stmt = conn.prepare(
        "SELECT client_id FROM client_relations \
          WHERE related_client_id = ?1 AND relationship IN ('son', 'daughter') \
         UNION \
         SELECT related_client_id FROM client_relations \
          WHERE client_id = ?1 AND relationship IN ('father', 'mother')",
    )?;

    let mut seen = HashSet::from([ancestor]);
    let mut frontier = vec![ancestor];
    for _ in 0..MAX_DEPTH {
        let mut next = Vec::new();
        for person in frontier.drain(..) {
            let parents = stmt
                .query_map(params![person], |row| row.get::<_, i64>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for parent in parents {
                if parent == descendant {
                    return Err(AppError::validation(
                        "That would make somebody their own ancestor. Check which way round the \
                         relationship goes.",
                    ));
                }
                if seen.insert(parent) {
                    next.push(parent);
                }
            }
        }
        if next.is_empty() {
            break;
        }
        frontier = next;
    }
    Ok(())
}
