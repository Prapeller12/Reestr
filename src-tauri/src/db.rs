// Слой БД: открытие соединения, PRAGMA на каждом соединении и раннер миграций
// по schema_version. Миграции эмбедятся через include_str!.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::ApiError;

/// Эмбед-миграции, упорядоченные по номеру. Новые изменения схемы — только новыми
/// файлами (0002_*.sql, ...); 0001_init.sql после заморозки не редактируется.
pub(crate) const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../migrations/0001_init.sql")),
    (2, include_str!("../migrations/0002_kind_and_links.sql")),
    (3, include_str!("../migrations/0003_field_overrides.sql")),
    (4, include_str!("../migrations/0004_theme_kind.sql")),
];

/// Открыть/создать БД, выставить PRAGMA и домигрировать. Идемпотентно.
pub fn open_and_migrate(path: &Path) -> Result<Connection, ApiError> {
    let mut conn = Connection::open(path)?;

    // PRAGMA — В КОДЕ, на каждом соединении (WAL нельзя внутри транзакции миграции).
    conn.execute_batch(
        "PRAGMA foreign_keys = ON; \
         PRAGMA journal_mode = WAL; \
         PRAGMA synchronous  = NORMAL;",
    )?;

    run_migrations(&mut conn)?;
    Ok(conn)
}

/// Применяет миграции с номером > текущей версии, каждую в своей транзакции.
/// На время миграций FK выключаются (rebuild родительских таблиц с drop/rename невозможен при
/// включённых FK): PRAGMA foreign_keys нельзя менять внутри транзакции — делаем это ВНЕ цикла.
pub(crate) fn run_migrations(conn: &mut Connection) -> Result<(), ApiError> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);")?;

    let current_opt: Option<i64> = conn
        .query_row("SELECT version FROM schema_version LIMIT 1", [], |r| r.get(0))
        .optional()?;

    let mut current = match current_opt {
        Some(v) => v,
        None => {
            conn.execute("INSERT INTO schema_version (version) VALUES (0)", [])?;
            0
        }
    };

    let has_pending = MIGRATIONS.iter().any(|(v, _)| *v > current);
    if !has_pending {
        return Ok(());
    }

    // Выключаем FK на время всех миграций (вне транзакции — валидно).
    conn.pragma_update(None, "foreign_keys", false)?;

    let mut migration_err: Option<ApiError> = None;
    for (version, sql) in MIGRATIONS {
        if *version > current {
            let tx = conn.transaction()?;
            if let Err(e) = tx
                .execute_batch(sql)
                .and_then(|_| {
                    tx.execute("UPDATE schema_version SET version = ?1", params![*version])
                        .map(|_| ())
                })
                .and_then(|_| tx.commit())
            {
                migration_err = Some(ApiError::db(format!(
                    "Не удалось обновить структуру базы данных (версия {version}). Подробности: {e}"
                )));
                break;
            }
            current = *version;
        }
    }

    // Диагностика целостности (не валим на строках-результатах) и возврат FK.
    let _ = conn.execute_batch("PRAGMA foreign_key_check;");
    conn.pragma_update(None, "foreign_keys", true)?;

    match migration_err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// БД в состоянии v1: применена только 0001, schema_version=1, FK включены.
    fn v1_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(MIGRATIONS[0].1).unwrap(); // 0001
        conn.execute_batch(
            "CREATE TABLE schema_version (version INTEGER NOT NULL); \
             INSERT INTO schema_version (version) VALUES (1);",
        )
        .unwrap();
        conn
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn migration_0002_preserves_data_and_overlay() {
        let mut conn = v1_conn();

        // Факты (v1-схема: recipient, без kind/deadline_src).
        conn.execute(
            "INSERT INTO IMPORT_BATCH (file_name, source, imported_at, count_new, count_changed, count_same) \
             VALUES ('f.txt','1C','2026-01-01 00:00:00',2,0,0)",
            [],
        )
        .unwrap();
        let batch = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO DOCUMENT (reg_number,reg_date,recipient,topic,signer,addressees,ref,import_batch_id,created_at,updated_at) \
             VALUES ('100/48','2026-01-12','АО Гранит','о стоимости','Ваган','Екшембиев','о стоимости (№ 100/48 от 12.01.2026)',?1,'2026-01-01 00:00:00','2026-01-01 00:00:00')",
            [batch],
        ).unwrap();
        conn.execute(
            "INSERT INTO DOCUMENT (reg_number,reg_date,recipient,topic,signer,addressees,ref,import_batch_id,created_at,updated_at) \
             VALUES ('100/772','2026-01-16','АО Гранит','о кооперации','Ваган','Ермаков','о кооперации (№ 100/772 от 16.01.2026)',?1,'2026-01-01 00:00:00','2026-01-01 00:00:00')",
            [batch],
        ).unwrap();

        // Оверлей: тема, дедлайн, привязка (задача 100/772 → письмо-ссылка 100/48).
        conn.execute("INSERT INTO THEME (name,user_created) VALUES ('Поставки',1)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO THEME_ASSIGNMENT (doc_reg,theme_name) VALUES ('100/48','Поставки')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO DEADLINE (doc_reg,end_date,set_at) VALUES ('100/48','2026-03-01','2026-01-02 00:00:00')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO LINK (doc_reg,target_ref,linked_date,created_at) \
             VALUES ('100/772','о стоимости (№ 100/48 от 12.01.2026)','2026-01-20','2026-01-20 00:00:00')",
            [],
        ).unwrap();

        // Миграция v1 → latest (применяются все pending: 0002 и далее 0003).
        run_migrations(&mut conn).unwrap();

        // schema_version = 4 (последняя миграция). Проверки ниже — про перенос данных в 0002.
        assert_eq!(count(&conn, "SELECT version FROM schema_version LIMIT 1"), 4);

        // Документы на месте, kind=outgoing, counterparty перенесён, deadline_src пуст.
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM DOCUMENT"), 2);
        let (kind, cp, ds): (String, String, String) = conn
            .query_row(
                "SELECT kind, counterparty, deadline_src FROM DOCUMENT WHERE reg_number='100/48'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(kind, "outgoing");
        assert_eq!(cp, "АО Гранит");
        assert_eq!(ds, "");

        // Оверлей цел.
        let theme: String = conn
            .query_row(
                "SELECT theme_name FROM THEME_ASSIGNMENT WHERE doc_reg='100/48'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(theme, "Поставки");
        let end_date: String = conn
            .query_row("SELECT end_date FROM DEADLINE WHERE doc_reg='100/48'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(end_date, "2026-03-01");

        // LINK перенесён в (task_reg, letter_reg, letter_kind).
        let (task, letter, lk): (String, String, String) = conn
            .query_row(
                "SELECT task_reg, letter_reg, letter_kind FROM LINK",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(task, "100/772");
        assert_eq!(letter, "100/48");
        assert_eq!(lk, "outgoing");

        // Идемпотентность: повторная миграция ничего не меняет.
        run_migrations(&mut conn).unwrap();
        assert_eq!(count(&conn, "SELECT version FROM schema_version LIMIT 1"), 4);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM DOCUMENT"), 2);

        // Целостность FK: нарушений нет.
        let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
        let mut rows = stmt.query([]).unwrap();
        assert!(rows.next().unwrap().is_none(), "foreign_key_check должен быть пуст");
    }

    /// БД в состоянии v2: применены 0001+0002, schema_version=2, есть документ + оверлей.
    /// FK выключены на время rebuild-миграции 0002 (как в раннере), затем включены.
    fn v2_conn_with_data() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        conn.execute_batch(MIGRATIONS[0].1).unwrap(); // 0001
        conn.execute_batch(MIGRATIONS[1].1).unwrap(); // 0002 (rebuild DOCUMENT/LINK/…)
        conn.execute_batch(
            "CREATE TABLE schema_version (version INTEGER NOT NULL); \
             INSERT INTO schema_version (version) VALUES (2);",
        )
        .unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

        conn.execute(
            "INSERT INTO IMPORT_BATCH (kind, file_name, source, imported_at, count_new, count_changed, count_same) \
             VALUES ('outgoing','f.txt','1C','2026-01-01 00:00:00',1,0,0)",
            [],
        )
        .unwrap();
        let batch = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO DOCUMENT (kind, reg_number, reg_date, counterparty, topic, signer, addressees, deadline_src, ref, import_batch_id, created_at, updated_at) \
             VALUES ('outgoing','100/48','2026-01-12','АО Гранит','тема','Ваган','Екшембиев','','ref',?1,'2026-01-01 00:00:00','2026-01-01 00:00:00')",
            [batch],
        ).unwrap();
        conn.execute("INSERT INTO THEME (name,user_created) VALUES ('Поставки',1)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO THEME_ASSIGNMENT (doc_reg,theme_name) VALUES ('100/48','Поставки')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO DEADLINE (doc_reg,end_date,set_at) VALUES ('100/48','2026-03-01','2026-01-02 00:00:00')",
            [],
        ).unwrap();
        conn
    }

    #[test]
    fn migration_0003_additive_preserves_data_and_overlay() {
        let mut conn = v2_conn_with_data();
        assert_eq!(count(&conn, "SELECT version FROM schema_version LIMIT 1"), 2);

        // Миграция v2 → latest (аддитивная 0003 + rebuild 0004).
        run_migrations(&mut conn).unwrap();
        assert_eq!(count(&conn, "SELECT version FROM schema_version LIMIT 1"), 4);

        // Существующие факты и оверлей 0002 целы.
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM DOCUMENT"), 1);
        let theme: String = conn
            .query_row(
                "SELECT theme_name FROM THEME_ASSIGNMENT WHERE doc_reg='100/48'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(theme, "Поставки");
        let dl: String = conn
            .query_row("SELECT end_date FROM DEADLINE WHERE doc_reg='100/48'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(dl, "2026-03-01");

        // Новые таблицы существуют и пишутся.
        conn.execute(
            "INSERT INTO FIELD_OVERRIDE (doc_reg, field, value, set_at) VALUES ('100/48','signer','Кузнецов','2026-01-20 00:00:00')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO PARTY_LIBRARY (value, role) VALUES ('Кузнецов','signer')",
            [],
        )
        .unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM FIELD_OVERRIDE"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM PARTY_LIBRARY"), 1);

        // Идемпотентность: повторная миграция ничего не ломает.
        run_migrations(&mut conn).unwrap();
        assert_eq!(count(&conn, "SELECT version FROM schema_version LIMIT 1"), 4);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM FIELD_OVERRIDE"), 1);

        // Целостность FK.
        let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
        let mut rows = stmt.query([]).unwrap();
        assert!(rows.next().unwrap().is_none(), "foreign_key_check должен быть пуст");
    }

    /// БД в состоянии v3: применены 0001+0002+0003, schema_version=3, есть исходящий + тема.
    /// FK выключены на время rebuild-миграций 0002 (как в раннере), затем включены.
    fn v3_conn_with_theme() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        conn.execute_batch(MIGRATIONS[0].1).unwrap(); // 0001
        conn.execute_batch(MIGRATIONS[1].1).unwrap(); // 0002
        conn.execute_batch(MIGRATIONS[2].1).unwrap(); // 0003
        conn.execute_batch(
            "CREATE TABLE schema_version (version INTEGER NOT NULL); \
             INSERT INTO schema_version (version) VALUES (3);",
        )
        .unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

        conn.execute(
            "INSERT INTO IMPORT_BATCH (kind, file_name, source, imported_at, count_new, count_changed, count_same) \
             VALUES ('outgoing','f.txt','1C','2026-01-01 00:00:00',1,0,0)",
            [],
        )
        .unwrap();
        let batch = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO DOCUMENT (kind, reg_number, reg_date, counterparty, topic, signer, addressees, deadline_src, ref, import_batch_id, created_at, updated_at) \
             VALUES ('outgoing','100/48','2026-01-12','АО Гранит','тема','Ваган','Екшембиев','','ref',?1,'2026-01-01 00:00:00','2026-01-01 00:00:00')",
            [batch],
        ).unwrap();
        conn.execute("INSERT INTO THEME (name,user_created) VALUES ('Поставки',1)", [])
            .unwrap();
        // v3-схема THEME_ASSIGNMENT — (doc_reg, theme_name), БЕЗ kind (темы только исходящих).
        conn.execute(
            "INSERT INTO THEME_ASSIGNMENT (doc_reg,theme_name) VALUES ('100/48','Поставки')",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn migration_0004_theme_kind_preserves_outgoing_assignments() {
        let mut conn = v3_conn_with_theme();
        assert_eq!(count(&conn, "SELECT version FROM schema_version LIMIT 1"), 3);

        // Миграция v3 → v4 (rebuild THEME_ASSIGNMENT под композитный ключ (kind, doc_reg)).
        run_migrations(&mut conn).unwrap();
        assert_eq!(count(&conn, "SELECT version FROM schema_version LIMIT 1"), 4);

        // Существующее назначение цело и помечено kind='outgoing' (темы были только у исходящих).
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM THEME_ASSIGNMENT"), 1);
        let (kind, theme): (String, String) = conn
            .query_row(
                "SELECT kind, theme_name FROM THEME_ASSIGNMENT WHERE doc_reg='100/48'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(kind, "outgoing");
        assert_eq!(theme, "Поставки");

        // Новый ключ (kind, doc_reg) допускает независимую тему входящему с ТЕМ ЖЕ номером.
        conn.execute(
            "INSERT INTO THEME_ASSIGNMENT (kind, doc_reg, theme_name) VALUES ('incoming','100/48','Поставки')",
            [],
        )
        .unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM THEME_ASSIGNMENT"), 2);

        // Идемпотентность: повторная миграция ничего не меняет.
        run_migrations(&mut conn).unwrap();
        assert_eq!(count(&conn, "SELECT version FROM schema_version LIMIT 1"), 4);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM THEME_ASSIGNMENT"), 2);

        // Целостность FK: нарушений нет.
        let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
        let mut rows = stmt.query([]).unwrap();
        assert!(rows.next().unwrap().is_none(), "foreign_key_check должен быть пуст");
    }
}
