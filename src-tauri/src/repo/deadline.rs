// DeadlineRepo — ручной срок (оверлей). Сброс → возврат к regDate+30 (вычисляется в domain).

use rusqlite::{params, Connection};

use crate::error::ApiError;

/// Все сроки (doc_reg, end_date) — для предзагрузки ViewContext.
pub fn all(conn: &Connection) -> Result<Vec<(String, String)>, ApiError> {
    let mut stmt = conn.prepare("SELECT doc_reg, end_date FROM DEADLINE")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Задать/изменить срок (upsert).
pub fn set(conn: &Connection, doc_reg: &str, end_date: &str, now: &str) -> Result<(), ApiError> {
    conn.execute(
        "INSERT INTO DEADLINE (doc_reg, end_date, set_at) VALUES (?1, ?2, ?3) \
         ON CONFLICT(doc_reg) DO UPDATE SET end_date = excluded.end_date, set_at = excluded.set_at",
        params![doc_reg, end_date, now],
    )?;
    Ok(())
}

/// Сбросить срок → документ вернётся к дефолтному regDate+30.
pub fn clear(conn: &Connection, doc_reg: &str) -> Result<(), ApiError> {
    conn.execute("DELETE FROM DEADLINE WHERE doc_reg = ?1", params![doc_reg])?;
    Ok(())
}
