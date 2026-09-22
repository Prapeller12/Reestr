// PartyLibraryRepo — справочник участников (docs/КОНЦЕПЦИЯ-правка-полей.md §3).
// Пополняется импортом (оба вида) и ручной правкой сразу. Только пополняется (§6 инв.3).
// role ∈ {'signer','addressee'}; хранит уникальные (value, role).

use rusqlite::{params, Connection};

use crate::error::ApiError;

/// Роли справочника (для валидации get_field_suggestions).
pub const ROLES: [&str; 2] = ["signer", "addressee"];

/// Валидна ли роль справочника.
pub fn is_valid_role(role: &str) -> bool {
    ROLES.contains(&role)
}

/// Роль справочника для правимого поля: signer→signer, addressees→addressee.
pub fn role_for_field(field: &str) -> Option<&'static str> {
    match field {
        "signer" => Some("signer"),
        "addressees" => Some("addressee"),
        _ => None,
    }
}

/// Пополнить справочник одним значением (INSERT OR IGNORE). Пустое/пробельное — пропускаем.
pub fn collect(conn: &Connection, value: &str, role: &str) -> Result<(), ApiError> {
    let v = value.trim();
    if v.is_empty() {
        return Ok(());
    }
    conn.execute(
        "INSERT OR IGNORE INTO PARTY_LIBRARY (value, role) VALUES (?1, ?2)",
        params![v, role],
    )?;
    Ok(())
}

/// Пополнить из полей строки документа: signer→'signer', addressees→'addressee'.
/// Пустые (у входящих signer='') пропускаются. Используется в цикле import_apply (оба вида).
pub fn collect_row(conn: &Connection, signer: &str, addressees: &str) -> Result<(), ApiError> {
    collect(conn, signer, "signer")?;
    collect(conn, addressees, "addressee")?;
    Ok(())
}

/// Значения справочника для роли (автодополнение get_field_suggestions), по алфавиту.
pub fn list(conn: &Connection, role: &str) -> Result<Vec<String>, ApiError> {
    let mut stmt =
        conn.prepare("SELECT value FROM PARTY_LIBRARY WHERE role = ?1 ORDER BY value")?;
    let rows = stmt.query_map(params![role], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;
    use rusqlite::Connection;

    fn migrated() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_migrations(&mut conn).unwrap();
        conn
    }

    #[test]
    fn collect_from_both_kinds_and_skip_empty() {
        let conn = migrated();
        // Исходящее: есть и подписант, и адресаты.
        collect_row(&conn, "Иванов И.И.", "Петров П.П.").unwrap();
        // Входящее: подписанта нет (''), адресаты есть → в справочник идёт только адресат.
        collect_row(&conn, "", "Сидоров С.С.").unwrap();
        // Дубликат подписанта из следующей выгрузки — INSERT OR IGNORE не плодит строк.
        collect_row(&conn, "Иванов И.И.", "Петров П.П.").unwrap();

        assert_eq!(list(&conn, "signer").unwrap(), vec!["Иванов И.И."]);
        assert_eq!(
            list(&conn, "addressee").unwrap(),
            vec!["Петров П.П.", "Сидоров С.С."]
        );
    }

    #[test]
    fn role_for_field_maps_addressees_to_addressee() {
        assert_eq!(role_for_field("signer"), Some("signer"));
        assert_eq!(role_for_field("addressees"), Some("addressee"));
        assert_eq!(role_for_field("nope"), None);
    }
}
