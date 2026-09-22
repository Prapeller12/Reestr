// ThemeRepo — темы (оверлей). Тема только пользовательская; документы без назначения → «Без темы».
// Ключ назначения — пара (kind, doc_reg): тема назначается документам ОБОИХ видов, а рег.номер
// уникален лишь в пределах вида (КОНЦЕПЦИЯ §5.6). Тема — общий namespace (одна тема может
// содержать и исходящие, и входящие).

use rusqlite::{params, Connection, ErrorCode};

use crate::dto::DocKind;
use crate::error::ApiError;
use crate::model::ThemeRow;

/// Служебное имя «отсутствия темы» — на фронте это ключ группы/фильтра NO_THEME (QA-3 п.9, шаг 4б).
const NO_THEME_CANON: &str = "без темы";

/// Проверка имени темы для ПИШУЩИХ операций (create/assign/bulk_assign): trim; пустое →
/// VALIDATION_ERROR; «Без темы» в любом регистре и с любыми пробелами → VALIDATION_ERROR
/// (служебное название). Возвращает trimmed-имя (внутренние пробелы не трогаем).
/// delete_theme эту проверку НЕ применяет — иначе ошибочно созданную «Без темы» не удалить.
pub fn validate_theme_name(name: &str) -> Result<&str, ApiError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ApiError::validation("Укажите название темы."));
    }
    let canon = name
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    if canon == NO_THEME_CANON {
        return Err(ApiError::validation(
            "Название «Без темы» занято служебной группой. Укажите другое.",
        ));
    }
    Ok(name)
}

/// Создать тему (user_created=1). Дубликат → DUPLICATE_THEME (§10.3).
pub fn create_theme(conn: &Connection, name: &str) -> Result<(), ApiError> {
    let name = validate_theme_name(name)?;
    match conn.execute(
        "INSERT INTO THEME (name, user_created) VALUES (?1, 1)",
        params![name],
    ) {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(err, _))
            if err.code == ErrorCode::ConstraintViolation =>
        {
            Err(ApiError::duplicate_theme(format!(
                "Тема «{name}» уже существует"
            )))
        }
        Err(e) => Err(e.into()),
    }
}

/// Гарантировать существование темы (для назначения; FK THEME_ASSIGNMENT → THEME).
pub fn ensure_theme(conn: &Connection, name: &str) -> Result<(), ApiError> {
    let name = validate_theme_name(name)?;
    conn.execute(
        "INSERT OR IGNORE INTO THEME (name, user_created) VALUES (?1, 1)",
        params![name],
    )?;
    Ok(())
}

/// Назначить тему документу любого вида (upsert по (kind, doc_reg)). Тема гарантируется автоматически.
pub fn assign(
    conn: &Connection,
    kind: DocKind,
    doc_reg: &str,
    theme_name: &str,
) -> Result<(), ApiError> {
    let theme_name = validate_theme_name(theme_name)?;
    ensure_theme(conn, theme_name)?;
    conn.execute(
        "INSERT INTO THEME_ASSIGNMENT (kind, doc_reg, theme_name) VALUES (?1, ?2, ?3) \
         ON CONFLICT(kind, doc_reg) DO UPDATE SET theme_name = excluded.theme_name",
        params![kind.as_str(), doc_reg, theme_name],
    )?;
    Ok(())
}

/// Снять назначение темы с документа (по паре (kind, doc_reg)). true — если назначение было.
pub fn clear_assignment(conn: &Connection, kind: DocKind, doc_reg: &str) -> Result<bool, ApiError> {
    let n = conn.execute(
        "DELETE FROM THEME_ASSIGNMENT WHERE kind = ?1 AND doc_reg = ?2",
        params![kind.as_str(), doc_reg],
    )?;
    Ok(n > 0)
}

/// Все назначения ((kind, doc_reg), theme_name) — для предзагрузки ViewContext.
pub fn all_assignments(
    conn: &Connection,
) -> Result<Vec<((DocKind, String), String)>, ApiError> {
    let mut stmt = conn.prepare("SELECT kind, doc_reg, theme_name FROM THEME_ASSIGNMENT")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;
    let mut out = Vec::new();
    for r in rows {
        let (kind_s, doc_reg, theme_name) = r?;
        // Неизвестный вид пропускаем — оверлей без валидного вида не участвует в представлении.
        if let Some(kind) = DocKind::from_str(&kind_s) {
            out.push(((kind, doc_reg), theme_name));
        }
    }
    Ok(out)
}

/// Список тем + счётчики назначений по документам ВСЕХ видов (для list_themes).
pub fn list_with_counts(conn: &Connection) -> Result<Vec<ThemeRow>, ApiError> {
    let mut stmt = conn.prepare(
        "SELECT t.name, t.user_created, \
         (SELECT COUNT(*) FROM THEME_ASSIGNMENT a WHERE a.theme_name = t.name) \
         FROM THEME t ORDER BY t.name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ThemeRow {
            name: r.get::<_, String>(0)?,
            user_created: r.get::<_, i64>(1)? != 0,
            document_count: r.get::<_, i64>(2)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Удалить тему (п.9 QA-3): её назначения (документы ОБОИХ видов) снимаются — письма уходят
/// в «Без темы», затем удаляется сама тема. Одна транзакция: ошибка на любом шаге → откат.
/// Имя сравнивается после trim(), регистрозависимо (THEME.name — BINARY).
/// Пустое/пробельное имя → VALIDATION_ERROR; темы нет → NOT_FOUND (БД не меняется).
/// Служебное имя «Без темы» НЕ запрещено: так убирается тема, созданная с ним по ошибке.
/// Возвращает reassigned — число снятых СТРОК назначений (включая теоретические осиротевшие),
/// та же метрика, что documentCount в list_themes; с числом видимых строк группы реестра
/// (зависит от фильтров) не сверять.
pub fn delete(conn: &mut Connection, name: &str) -> Result<i64, ApiError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ApiError::validation("Укажите название темы."));
    }
    let tx = conn.transaction()?;
    let exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM THEME WHERE name = ?1)",
        params![name],
        |r| r.get(0),
    )?;
    if !exists {
        return Err(ApiError::not_found(format!("Тема «{name}» не найдена")));
    }
    let reassigned = tx.execute(
        "DELETE FROM THEME_ASSIGNMENT WHERE theme_name = ?1",
        params![name],
    )? as i64;
    tx.execute("DELETE FROM THEME WHERE name = ?1", params![name])?;
    tx.commit()?;
    Ok(reassigned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;
    use crate::model::DocFacts;
    use crate::repo;

    fn migrated() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_migrations(&mut conn).unwrap();
        conn
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    fn names(conn: &Connection) -> Vec<(String, i64)> {
        list_with_counts(conn)
            .unwrap()
            .into_iter()
            .map(|t| (t.name, t.document_count))
            .collect()
    }

    fn code(r: Result<impl std::fmt::Debug, ApiError>) -> String {
        r.expect_err("ожидалась ошибка").code
    }

    #[test]
    fn delete_theme_reassigns_both_kinds() {
        let mut conn = migrated();
        assign(&conn, DocKind::Outgoing, "100/1", "Тема 1").unwrap();
        assign(&conn, DocKind::Incoming, "100/1", "Тема 1").unwrap();
        assign(&conn, DocKind::Outgoing, "100/2", "Тема 1").unwrap();
        assign(&conn, DocKind::Outgoing, "100/3", "Тема 2").unwrap();

        assert_eq!(delete(&mut conn, "Тема 1").unwrap(), 3);
        assert_eq!(
            all_assignments(&conn).unwrap(),
            vec![((DocKind::Outgoing, "100/3".to_string()), "Тема 2".to_string())]
        );
        assert_eq!(names(&conn), vec![("Тема 2".to_string(), 1)]);
    }

    #[test]
    fn delete_empty_theme_returns_zero() {
        let mut conn = migrated();
        create_theme(&conn, "Пустая").unwrap();
        assert_eq!(delete(&mut conn, "Пустая").unwrap(), 0);
        assert!(names(&conn).is_empty());
    }

    #[test]
    fn delete_missing_theme_not_found() {
        let mut conn = migrated();
        assign(&conn, DocKind::Outgoing, "100/1", "Тема").unwrap();
        assert_eq!(code(delete(&mut conn, "Нет такой")), "NOT_FOUND");
        // «Без темы» в THEME не хранится — это отсутствие темы.
        assert_eq!(code(delete(&mut conn, "Без темы")), "NOT_FOUND");
        assert_eq!(names(&conn), vec![("Тема".to_string(), 1)]);
    }

    #[test]
    fn delete_blank_name_is_validation() {
        let mut conn = migrated();
        assert_eq!(code(delete(&mut conn, "")), "VALIDATION_ERROR");
        assert_eq!(code(delete(&mut conn, "   ")), "VALIDATION_ERROR");
    }

    #[test]
    fn delete_trims_and_is_case_sensitive() {
        let mut conn = migrated();
        assign(&conn, DocKind::Outgoing, "100/1", "Поставки").unwrap();
        assert_eq!(code(delete(&mut conn, "поставки")), "NOT_FOUND");
        assert_eq!(names(&conn), vec![("Поставки".to_string(), 1)]);
        assert_eq!(delete(&mut conn, "  Поставки  ").unwrap(), 1);
        assert!(names(&conn).is_empty());
    }

    #[test]
    fn delete_keeps_facts_and_other_overlay() {
        let mut conn = migrated();
        // Реальное исходящее + справочник + весь оверлей на том же doc_reg.
        let batch = repo::import::insert_batch(
            &conn,
            "f.txt",
            "1C",
            DocKind::Outgoing,
            "2026-01-01 00:00:00",
        )
        .unwrap();
        let facts = DocFacts {
            kind: DocKind::Outgoing,
            reg_number: "100/48",
            reg_date: "2026-01-12",
            counterparty: "АО Гранит",
            topic: "тема",
            signer: "Ваган",
            addressees: "Петров",
            deadline_src: "",
            ref_: "тема (№ 100/48 от 12.01.2026)",
        };
        repo::document::insert(&conn, &facts, batch, "2026-01-01 00:00:00").unwrap();
        repo::party::collect_row(&conn, "Ваган", "Петров").unwrap();
        assign(&conn, DocKind::Outgoing, "100/48", "Тема").unwrap();
        repo::link::add(&conn, "100/48", "11006", DocKind::Incoming, "2026-01-20 00:00:00").unwrap();
        repo::deadline::set(&conn, "100/48", "2026-03-01", "2026-01-20 00:00:00").unwrap();
        repo::field_override::set(&conn, "100/48", "signer", "Кузнецов", "2026-01-20 00:00:00")
            .unwrap();

        let tables = [
            "DOCUMENT",
            "IMPORT_BATCH",
            "PARTY_LIBRARY",
            "LINK",
            "DEADLINE",
            "FIELD_OVERRIDE",
        ];
        let before: Vec<i64> = tables.iter().map(|t| count(&conn, t)).collect();
        assert!(before.iter().all(|&n| n >= 1), "проверка не на пустоте: {before:?}");

        assert_eq!(delete(&mut conn, "Тема").unwrap(), 1);

        let after: Vec<i64> = tables.iter().map(|t| count(&conn, t)).collect();
        assert_eq!(before, after);
        assert_eq!(count(&conn, "THEME_ASSIGNMENT"), 0);
        assert_eq!(count(&conn, "THEME"), 0);
    }

    #[test]
    fn delete_is_atomic_on_failure() {
        let mut conn = migrated();
        assign(&conn, DocKind::Outgoing, "100/1", "Тема").unwrap();
        assign(&conn, DocKind::Incoming, "100/2", "Тема").unwrap();
        conn.execute_batch(
            "CREATE TEMP TRIGGER abort_theme_delete BEFORE DELETE ON THEME \
             BEGIN SELECT RAISE(ABORT, 'boom'); END;",
        )
        .unwrap();

        assert_eq!(code(delete(&mut conn, "Тема")), "DB_ERROR");
        // Транзакция закрыта откатом — соединение не осталось в открытой транзакции.
        assert!(conn.is_autocommit());
        // Первый DELETE (назначения) откатился, тема на месте.
        assert_eq!(names(&conn), vec![("Тема".to_string(), 2)]);
    }

    #[test]
    fn recreate_after_delete() {
        let mut conn = migrated();
        assign(&conn, DocKind::Outgoing, "100/1", "Тема").unwrap();
        delete(&mut conn, "Тема").unwrap();
        create_theme(&conn, "Тема").unwrap();
        assert_eq!(names(&conn), vec![("Тема".to_string(), 0)]);
    }

    // --- 4б: служебное имя «Без темы» запрещено писателям тем ---

    #[test]
    fn validate_theme_name_rejects_no_theme_variants() {
        for bad in ["Без темы", "без темы", "  БЕЗ   ТЕМЫ  ", "Без\tтемы"] {
            let err = validate_theme_name(bad).expect_err(bad);
            assert_eq!(err.code, "VALIDATION_ERROR", "{bad}");
            assert!(err.message.contains("служебной группой"), "{bad}");
        }
        assert_eq!(code(validate_theme_name("   ")), "VALIDATION_ERROR");
        assert_eq!(validate_theme_name("Без темы 2").unwrap(), "Без темы 2");
        assert_eq!(validate_theme_name("  Тема  ").unwrap(), "Тема");
    }

    #[test]
    fn create_theme_rejects_no_theme() {
        let conn = migrated();
        assert_eq!(code(create_theme(&conn, " без  ТЕМЫ ")), "VALIDATION_ERROR");
        assert_eq!(count(&conn, "THEME"), 0);
    }

    #[test]
    fn assign_rejects_no_theme() {
        let conn = migrated();
        assert_eq!(
            code(assign(&conn, DocKind::Outgoing, "100/1", "Без темы")),
            "VALIDATION_ERROR"
        );
        assert_eq!(count(&conn, "THEME"), 0);
        assert_eq!(count(&conn, "THEME_ASSIGNMENT"), 0);
    }

    #[test]
    fn bulk_assign_path_rejects_no_theme() {
        // bulk_assign_themes: ensure_theme в транзакции → ошибка → откат (тема не создана).
        let mut conn = migrated();
        let tx = conn.transaction().unwrap();
        assert_eq!(code(ensure_theme(&tx, "БЕЗ ТЕМЫ")), "VALIDATION_ERROR");
        drop(tx);
        assert_eq!(count(&conn, "THEME"), 0);
        assert_eq!(count(&conn, "THEME_ASSIGNMENT"), 0);
    }

    #[test]
    fn delete_allows_legacy_no_theme_name() {
        // Тема «Без темы», созданная до запрета (сырым SQL), удаляется штатно.
        let mut conn = migrated();
        conn.execute("INSERT INTO THEME (name, user_created) VALUES ('Без темы', 1)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO THEME_ASSIGNMENT (kind, doc_reg, theme_name) VALUES ('outgoing', '100/1', 'Без темы')",
            [],
        )
        .unwrap();
        assert_eq!(delete(&mut conn, "Без темы").unwrap(), 1);
        assert_eq!(count(&conn, "THEME"), 0);
        assert_eq!(count(&conn, "THEME_ASSIGNMENT"), 0);
    }
}
