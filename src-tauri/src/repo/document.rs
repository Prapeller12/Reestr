// DocumentRepo — факты из 1С. Ключ — пара (kind, reg_number). Импорт только INSERT/UPDATE.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::dto::DocKind;
use crate::error::ApiError;
use crate::model::{DocFacts, DocumentRecord};

const COLS: &str = "kind, reg_number, reg_date, counterparty, topic, signer, addressees, \
     deadline_src, ref, import_batch_id, created_at, updated_at";

fn map_row(row: &Row) -> rusqlite::Result<DocumentRecord> {
    let kind_s: String = row.get(0)?;
    Ok(DocumentRecord {
        kind: DocKind::from_str(&kind_s).unwrap_or(DocKind::Outgoing),
        reg_number: row.get(1)?,
        reg_date: row.get(2)?,
        counterparty: row.get(3)?,
        topic: row.get(4)?,
        signer: row.get(5)?,
        addressees: row.get(6)?,
        deadline_src: row.get(7)?,
        ref_: row.get(8)?,
        import_batch_id: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

pub fn get(
    conn: &Connection,
    kind: DocKind,
    reg_number: &str,
) -> Result<Option<DocumentRecord>, ApiError> {
    let sql = format!("SELECT {COLS} FROM DOCUMENT WHERE kind = ?1 AND reg_number = ?2");
    let rec = conn
        .query_row(&sql, params![kind.as_str(), reg_number], map_row)
        .optional()?;
    Ok(rec)
}

pub fn exists(conn: &Connection, kind: DocKind, reg_number: &str) -> Result<bool, ApiError> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM DOCUMENT WHERE kind = ?1 AND reg_number = ?2",
        params![kind.as_str(), reg_number],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

pub fn list_all(conn: &Connection) -> Result<Vec<DocumentRecord>, ApiError> {
    let sql = format!("SELECT {COLS} FROM DOCUMENT ORDER BY reg_date, reg_number");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// INSERT новой строки: created_at = updated_at = now.
pub fn insert(conn: &Connection, facts: &DocFacts, batch_id: i64, now: &str) -> Result<(), ApiError> {
    conn.execute(
        "INSERT INTO DOCUMENT \
         (kind, reg_number, reg_date, counterparty, topic, signer, addressees, deadline_src, ref, \
          import_batch_id, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![
            facts.kind.as_str(),
            facts.reg_number,
            facts.reg_date,
            facts.counterparty,
            facts.topic,
            facts.signer,
            facts.addressees,
            facts.deadline_src,
            facts.ref_,
            batch_id,
            now
        ],
    )?;
    Ok(())
}

/// UPDATE сравниваемых полей + batch_id + updated_at; created_at не трогаем. Ключ (kind, reg_number).
pub fn update_fields(
    conn: &Connection,
    facts: &DocFacts,
    batch_id: i64,
    now: &str,
) -> Result<(), ApiError> {
    conn.execute(
        "UPDATE DOCUMENT SET \
         reg_date = ?3, counterparty = ?4, topic = ?5, signer = ?6, addressees = ?7, \
         deadline_src = ?8, ref = ?9, import_batch_id = ?10, updated_at = ?11 \
         WHERE kind = ?1 AND reg_number = ?2",
        params![
            facts.kind.as_str(),
            facts.reg_number,
            facts.reg_date,
            facts.counterparty,
            facts.topic,
            facts.signer,
            facts.addressees,
            facts.deadline_src,
            facts.ref_,
            batch_id,
            now
        ],
    )?;
    Ok(())
}
