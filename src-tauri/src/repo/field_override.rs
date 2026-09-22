// FieldOverrideRepo — оверлей-правка полей signer/addressees исходящего (docs/КОНЦЕПЦИЯ-правка-полей.md).
// Ключ (doc_reg, field). Реверт = удаление строки → снова тянется факт из выгрузки.
// Только CRUD: приоритет «правка > факт» применяется в view::build_view, не здесь.

use rusqlite::{params, Connection};

use crate::error::ApiError;

/// Правимые поля. field в БД и контракте — 'signer' | 'addressees'.
pub const FIELDS: [&str; 2] = ["signer", "addressees"];

/// Валиден ли `field` как имя правимого поля.
pub fn is_valid_field(field: &str) -> bool {
    FIELDS.contains(&field)
}

/// Все правки: ((doc_reg, field), value) — для предзагрузки ViewContext.
pub fn all(conn: &Connection) -> Result<Vec<((String, String), String)>, ApiError> {
    let mut stmt = conn.prepare("SELECT doc_reg, field, value FROM FIELD_OVERRIDE")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            (r.get::<_, String>(0)?, r.get::<_, String>(1)?),
            r.get::<_, String>(2)?,
        ))
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Задать/изменить правку поля (upsert).
pub fn set(
    conn: &Connection,
    doc_reg: &str,
    field: &str,
    value: &str,
    now: &str,
) -> Result<(), ApiError> {
    conn.execute(
        "INSERT INTO FIELD_OVERRIDE (doc_reg, field, value, set_at) VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(doc_reg, field) DO UPDATE SET value = excluded.value, set_at = excluded.set_at",
        params![doc_reg, field, value, now],
    )?;
    Ok(())
}

/// Снять правку поля (реверт к факту). true — если правка была.
pub fn clear(conn: &Connection, doc_reg: &str, field: &str) -> Result<bool, ApiError> {
    let n = conn.execute(
        "DELETE FROM FIELD_OVERRIDE WHERE doc_reg = ?1 AND field = ?2",
        params![doc_reg, field],
    )?;
    Ok(n > 0)
}
