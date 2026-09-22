// LinkRepo — привязки письма к задаче (оверлей). 0..* привязок на задачу; одно письмо —
// к нескольким задачам. UNIQUE(task_reg, letter_reg, letter_kind) защищает от точного дубля.

use rusqlite::{params, Connection, Row};

use crate::dto::DocKind;
use crate::error::ApiError;
use crate::model::LinkRecord;

fn map_row(row: &Row) -> rusqlite::Result<LinkRecord> {
    let kind_s: String = row.get(3)?;
    Ok(LinkRecord {
        id: row.get(0)?,
        task_reg: row.get(1)?,
        letter_reg: row.get(2)?,
        letter_kind: DocKind::from_str(&kind_s).unwrap_or(DocKind::Outgoing),
        created_at: row.get(4)?,
    })
}

const COLS: &str = "id, task_reg, letter_reg, letter_kind, created_at";

/// Все привязки. Порядок задан явно: из него следует порядок узлов цепочки (§5.8).
pub fn list_all(conn: &Connection) -> Result<Vec<LinkRecord>, ApiError> {
    let sql = format!("SELECT {COLS} FROM LINK ORDER BY created_at, id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Привязки конкретной задачи (для карточки).
pub fn list_by_task(conn: &Connection, task_reg: &str) -> Result<Vec<LinkRecord>, ApiError> {
    let sql = format!("SELECT {COLS} FROM LINK WHERE task_reg = ?1 ORDER BY created_at, id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![task_reg], map_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Добавить привязку письма к задаче. Точный дубль игнорируется (INSERT OR IGNORE).
pub fn add(
    conn: &Connection,
    task_reg: &str,
    letter_reg: &str,
    letter_kind: DocKind,
    now: &str,
) -> Result<(), ApiError> {
    conn.execute(
        "INSERT OR IGNORE INTO LINK (task_reg, letter_reg, letter_kind, created_at) \
         VALUES (?1, ?2, ?3, ?4)",
        params![task_reg, letter_reg, letter_kind.as_str(), now],
    )?;
    Ok(())
}

/// Снять конкретную привязку. true — если что-то удалено.
pub fn detach(
    conn: &Connection,
    task_reg: &str,
    letter_reg: &str,
    letter_kind: DocKind,
) -> Result<bool, ApiError> {
    let n = conn.execute(
        "DELETE FROM LINK WHERE task_reg = ?1 AND letter_reg = ?2 AND letter_kind = ?3",
        params![task_reg, letter_reg, letter_kind.as_str()],
    )?;
    Ok(n > 0)
}
