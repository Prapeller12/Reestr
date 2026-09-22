// ImportRepo — история импортов (IMPORT_BATCH, помечена видом) и выборка документов по батчу.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::dto::DocKind;
use crate::error::ApiError;
use crate::model::{DocumentRecord, ImportBatchRecord};

fn map_batch(row: &Row) -> rusqlite::Result<ImportBatchRecord> {
    let kind_s: String = row.get(1)?;
    Ok(ImportBatchRecord {
        id: row.get(0)?,
        kind: DocKind::from_str(&kind_s).unwrap_or(DocKind::Outgoing),
        file_name: row.get(2)?,
        source: row.get(3)?,
        imported_at: row.get(4)?,
        count_new: row.get(5)?,
        count_changed: row.get(6)?,
        count_same: row.get(7)?,
    })
}

const BATCH_COLS: &str =
    "id, kind, file_name, source, imported_at, count_new, count_changed, count_same";

const DOC_COLS: &str = "kind, reg_number, reg_date, counterparty, topic, signer, addressees, \
     deadline_src, ref, import_batch_id, created_at, updated_at";

/// Создать batch-строку (счётчики 0) под вид и вернуть её id. Создаётся ПЕРВОЙ в импорт-транзакции.
pub fn insert_batch(
    conn: &Connection,
    file_name: &str,
    source: &str,
    kind: DocKind,
    imported_at: &str,
) -> Result<i64, ApiError> {
    conn.execute(
        "INSERT INTO IMPORT_BATCH (kind, file_name, source, imported_at, count_new, count_changed, count_same) \
         VALUES (?1, ?2, ?3, ?4, 0, 0, 0)",
        params![kind.as_str(), file_name, source, imported_at],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Записать финальные счётчики батча.
pub fn update_counts(
    conn: &Connection,
    batch_id: i64,
    count_new: i64,
    count_changed: i64,
    count_same: i64,
) -> Result<(), ApiError> {
    conn.execute(
        "UPDATE IMPORT_BATCH SET count_new = ?2, count_changed = ?3, count_same = ?4 WHERE id = ?1",
        params![batch_id, count_new, count_changed, count_same],
    )?;
    Ok(())
}

pub fn get_batch(conn: &Connection, batch_id: i64) -> Result<Option<ImportBatchRecord>, ApiError> {
    let sql = format!("SELECT {BATCH_COLS} FROM IMPORT_BATCH WHERE id = ?1");
    let rec = conn
        .query_row(&sql, params![batch_id], map_batch)
        .optional()?;
    Ok(rec)
}

/// История импортов по убыванию даты (новые сверху).
pub fn list_batches(conn: &Connection) -> Result<Vec<ImportBatchRecord>, ApiError> {
    let sql = format!("SELECT {BATCH_COLS} FROM IMPORT_BATCH ORDER BY imported_at DESC, id DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_batch)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn latest_batch_id(conn: &Connection) -> Result<Option<i64>, ApiError> {
    let id = conn
        .query_row(
            "SELECT id FROM IMPORT_BATCH ORDER BY id DESC LIMIT 1",
            [],
            |r| r.get::<_, i64>(0),
        )
        .optional()?;
    Ok(id)
}

/// Документы, чей последний импорт — данный батч (для get_compare).
pub fn docs_in_batch(conn: &Connection, batch_id: i64) -> Result<Vec<DocumentRecord>, ApiError> {
    let sql = format!(
        "SELECT {DOC_COLS} FROM DOCUMENT WHERE import_batch_id = ?1 ORDER BY reg_number"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![batch_id], |row| {
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
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}
