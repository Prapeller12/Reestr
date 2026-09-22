// Сборка DocumentView (DTO) из фактов + оверлея + статуса + цепочек.
// ViewContext предзагружает всё нужное одним пакетом запросов (данных немного —
// один локальный файл), чтобы domain::chain работал как чистый обход карт.
// Ключ документа — пара (kind, reg_number). Статус — только у исходящих (у входящих = null),
// а цепочка есть у обоих видов: у входящего это задачи, которые им закрыты.

use std::collections::HashMap;

use rusqlite::Connection;

use crate::domain::{chain, status};
use crate::dto::{AttachedLetter, Chain, DocKind, DocStatus, DocumentView};
use crate::error::ApiError;
use crate::model::{DocumentRecord, LinkRecord};
use crate::repo;

pub struct ViewContext {
    pub today: String,
    /// Порядок документов (по reg_date, reg_number) — детерминированный вывод реестра.
    pub order: Vec<(DocKind, String)>,
    pub docs_by_key: HashMap<(DocKind, String), DocumentRecord>,
    /// task_reg -> привязки задачи (агрегация для статуса/карточки).
    pub links_by_task: HashMap<String, Vec<LinkRecord>>,
    /// (kind, letter_reg) -> [task_reg] (backward-цепочка). Вид в ключе обязателен:
    /// рег. номер уникален лишь в пределах вида (§5.6).
    pub links_by_letter: HashMap<(DocKind, String), Vec<String>>,
    pub deadline_by_doc: HashMap<String, String>,
    /// (kind, doc_reg) -> theme_name. Тема назначается документам ОБОИХ видов; вид в ключе
    /// обязателен — рег.номер уникален лишь в пределах вида (§5.6).
    pub theme_by_doc: HashMap<(DocKind, String), String>,
    /// Оверлей-правки полей: (doc_reg, field) -> value. field ∈ {'signer','addressees'}.
    /// Оверлей только исходящих (doc_reg = reg_number). Приоритет «правка > факт» (§5a).
    pub override_by_doc: HashMap<(String, String), String>,
}

/// Загрузить полный контекст представления на дату `today`.
pub fn load(conn: &Connection, today: String) -> Result<ViewContext, ApiError> {
    let docs = repo::document::list_all(conn)?;
    let links = repo::link::list_all(conn)?;
    let deadlines = repo::deadline::all(conn)?;
    let themes = repo::theme::all_assignments(conn)?;
    let overrides = repo::field_override::all(conn)?;

    let mut order = Vec::with_capacity(docs.len());
    let mut docs_by_key = HashMap::with_capacity(docs.len());
    for d in docs {
        order.push((d.kind, d.reg_number.clone()));
        docs_by_key.insert((d.kind, d.reg_number.clone()), d);
    }

    let mut links_by_task: HashMap<String, Vec<LinkRecord>> = HashMap::new();
    let mut links_by_letter: HashMap<(DocKind, String), Vec<String>> = HashMap::new();
    for l in links {
        links_by_letter
            .entry((l.letter_kind, l.letter_reg.clone()))
            .or_default()
            .push(l.task_reg.clone());
        links_by_task.entry(l.task_reg.clone()).or_default().push(l);
    }

    let deadline_by_doc: HashMap<String, String> = deadlines.into_iter().collect();
    let theme_by_doc: HashMap<(DocKind, String), String> = themes.into_iter().collect();
    let override_by_doc: HashMap<(String, String), String> = overrides.into_iter().collect();

    Ok(ViewContext {
        today,
        order,
        docs_by_key,
        links_by_task,
        links_by_letter,
        deadline_by_doc,
        theme_by_doc,
        override_by_doc,
    })
}

/// Статус исходящего reg (None для входящих) — для LetterMatch/AttachedLetter/цепочек.
pub fn status_of(ctx: &ViewContext, kind: DocKind, reg: &str) -> Option<DocStatus> {
    if kind != DocKind::Outgoing {
        return None;
    }
    let doc = ctx.docs_by_key.get(&(DocKind::Outgoing, reg.to_string()))?;
    let end_date = ctx.deadline_by_doc.get(reg).map(String::as_str);
    let tl = ctx.links_by_task.get(reg);
    let has_in = tl.map_or(false, |v| v.iter().any(|l| l.letter_kind == DocKind::Incoming));
    let has_out = tl.map_or(false, |v| v.iter().any(|l| l.letter_kind == DocKind::Outgoing));
    let ds = if doc.deadline_src.is_empty() {
        None
    } else {
        Some(doc.deadline_src.as_str())
    };
    Some(status::compute(&doc.reg_date, ds, end_date, has_in, has_out, &ctx.today).status)
}

/// Собрать DocumentView для одного документа (None, если пары (kind, reg_number) нет).
pub fn build_view(ctx: &ViewContext, kind: DocKind, reg_number: &str) -> Option<DocumentView> {
    let doc = ctx.docs_by_key.get(&(kind, reg_number.to_string()))?;

    let maps = chain::ChainMaps {
        docs_by_key: &ctx.docs_by_key,
        links_by_task: &ctx.links_by_task,
        links_by_letter: &ctx.links_by_letter,
        deadline_by_doc: &ctx.deadline_by_doc,
        today: &ctx.today,
    };

    // Входящее письмо: статуса и своих привязок у него нет (§3, §6). Тема — есть: назначается
    // документам обоих видов, ключ (kind, reg_number). Цепочка — есть: это задачи, которые
    // закрыты этим письмом (предшественники).
    if kind == DocKind::Incoming {
        return Some(DocumentView {
            reg_number: doc.reg_number.clone(),
            kind,
            reg_date: doc.reg_date.clone(),
            counterparty: doc.counterparty.clone(),
            topic: doc.topic.clone(),
            // Правка полей — только у исходящих (§2); у входящих оверлея нет.
            signer: doc.signer.clone(),
            addressees: doc.addressees.clone(),
            signer_edited: false,
            addressees_edited: false,
            ref_: doc.ref_.clone(),
            deadline_src: doc.deadline_src.clone(),
            status: None,
            status_label: None,
            due_date: None,
            days_remaining: None,
            alert_level: None,
            remaining_text: None,
            theme: ctx
                .theme_by_doc
                .get(&(kind, reg_number.to_string()))
                .cloned(),
            links: Vec::new(),
            chain: Chain {
                predecessors: chain::predecessors(kind, reg_number, &maps),
                successors: Vec::new(),
            },
        });
    }

    // Исходящая задача: статус по привязкам, привязанные письма, цепочка.
    let end_date = ctx.deadline_by_doc.get(reg_number).map(String::as_str);
    let task_links = ctx.links_by_task.get(reg_number);
    let has_in = task_links.map_or(false, |v| v.iter().any(|l| l.letter_kind == DocKind::Incoming));
    let has_out = task_links.map_or(false, |v| v.iter().any(|l| l.letter_kind == DocKind::Outgoing));
    let ds = if doc.deadline_src.is_empty() {
        None
    } else {
        Some(doc.deadline_src.as_str())
    };
    let comp = status::compute(&doc.reg_date, ds, end_date, has_in, has_out, &ctx.today);

    // Эффективные signer/addressees: правка пользователя > факт из выгрузки (§5a).
    // Наличие FIELD_OVERRIDE = метка «изменено пользователем» (флаги *_edited).
    let signer_override = ctx
        .override_by_doc
        .get(&(reg_number.to_string(), "signer".to_string()));
    let addressees_override = ctx
        .override_by_doc
        .get(&(reg_number.to_string(), "addressees".to_string()));
    let signer = signer_override.cloned().unwrap_or_else(|| doc.signer.clone());
    let addressees = addressees_override
        .cloned()
        .unwrap_or_else(|| doc.addressees.clone());
    let signer_edited = signer_override.is_some();
    let addressees_edited = addressees_override.is_some();

    let mut links: Vec<AttachedLetter> = Vec::new();
    if let Some(v) = task_links {
        for l in v {
            let letter_doc = ctx.docs_by_key.get(&(l.letter_kind, l.letter_reg.clone()));
            let (topic, ref_) = letter_doc
                .map(|d| (d.topic.clone(), d.ref_.clone()))
                .unwrap_or_default();
            links.push(AttachedLetter {
                id: l.id,
                letter_reg: l.letter_reg.clone(),
                letter_kind: l.letter_kind,
                letter_topic: topic,
                letter_ref: ref_,
                letter_status: status_of(ctx, l.letter_kind, &l.letter_reg),
                created_at: l.created_at.clone(),
            });
        }
    }

    let chain = Chain {
        predecessors: chain::predecessors(kind, reg_number, &maps),
        successors: chain::successors(kind, reg_number, &maps),
    };

    Some(DocumentView {
        reg_number: doc.reg_number.clone(),
        kind,
        reg_date: doc.reg_date.clone(),
        counterparty: doc.counterparty.clone(),
        topic: doc.topic.clone(),
        signer,
        addressees,
        signer_edited,
        addressees_edited,
        ref_: doc.ref_.clone(),
        deadline_src: doc.deadline_src.clone(),
        status: Some(comp.status),
        status_label: Some(comp.status_label),
        due_date: Some(comp.due_date),
        days_remaining: Some(comp.days_remaining),
        alert_level: Some(comp.alert_level),
        remaining_text: Some(comp.remaining_text),
        theme: ctx
            .theme_by_doc
            .get(&(kind, reg_number.to_string()))
            .cloned(),
        links,
        chain,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;
    use crate::model::DocFacts;

    fn migrated() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_migrations(&mut conn).unwrap();
        conn
    }

    /// Вставить одно исходящее письмо (signer/addressees) через реальные repo-функции.
    fn insert_outgoing(conn: &Connection, reg: &str, signer: &str, addressees: &str) {
        let batch = repo::import::insert_batch(
            conn,
            "f.txt",
            "1C",
            DocKind::Outgoing,
            "2026-01-01 00:00:00",
        )
        .unwrap();
        let facts = DocFacts {
            kind: DocKind::Outgoing,
            reg_number: reg,
            reg_date: "2026-01-12",
            counterparty: "АО Гранит",
            topic: "тема",
            signer,
            addressees,
            deadline_src: "",
            ref_: "тема (№ 100/48 от 12.01.2026)",
        };
        repo::document::insert(conn, &facts, batch, "2026-01-01 00:00:00").unwrap();
    }

    fn effective(conn: &Connection, reg: &str) -> DocumentView {
        let ctx = load(conn, "2026-02-01".to_string()).unwrap();
        build_view(&ctx, DocKind::Outgoing, reg).unwrap()
    }

    #[test]
    fn override_beats_fact_and_survives_reimport() {
        let conn = migrated();
        insert_outgoing(&conn, "100/48", "Иванов (старый)", "Петров");

        // Пользователь правит подписанта.
        repo::field_override::set(&conn, "100/48", "signer", "Кузнецов (верно)", "2026-01-20 00:00:00")
            .unwrap();

        let v = effective(&conn, "100/48");
        assert_eq!(v.signer, "Кузнецов (верно)");
        assert!(v.signer_edited);
        // Неправленое поле — из факта.
        assert_eq!(v.addressees, "Петров");
        assert!(!v.addressees_edited);

        // Переимпорт присылает НОВОЕ значение подписанта И нового адресата (update_fields — как в import_apply).
        let facts = DocFacts {
            kind: DocKind::Outgoing,
            reg_number: "100/48",
            reg_date: "2026-01-12",
            counterparty: "АО Гранит",
            topic: "тема",
            signer: "Сидоров (импорт)",
            addressees: "Ермаков (импорт)",
            deadline_src: "",
            ref_: "тема (№ 100/48 от 12.01.2026)",
        };
        repo::document::update_fields(&conn, &facts, 1, "2026-01-25 00:00:00").unwrap();

        let v = effective(&conn, "100/48");
        // Правленое поле не изменилось ни старым, ни новым значением из 1С.
        assert_eq!(v.signer, "Кузнецов (верно)");
        assert!(v.signer_edited);
        // Неправленое поле обновилось из импорта.
        assert_eq!(v.addressees, "Ермаков (импорт)");
        assert!(!v.addressees_edited);
    }

    #[test]
    fn clear_override_reverts_to_fact() {
        let conn = migrated();
        insert_outgoing(&conn, "100/48", "Иванов (факт)", "Петров");
        repo::field_override::set(&conn, "100/48", "signer", "Кузнецов", "2026-01-20 00:00:00")
            .unwrap();
        assert_eq!(effective(&conn, "100/48").signer, "Кузнецов");

        // Реверт → снова факт из выгрузки.
        let removed = repo::field_override::clear(&conn, "100/48", "signer").unwrap();
        assert!(removed);
        let v = effective(&conn, "100/48");
        assert_eq!(v.signer, "Иванов (факт)");
        assert!(!v.signer_edited);
    }

    /// Вставить одно входящее письмо через реальные repo-функции.
    fn insert_incoming(conn: &Connection, reg: &str, topic: &str) {
        let batch = repo::import::insert_batch(
            conn,
            "in.txt",
            "1C",
            DocKind::Incoming,
            "2026-01-01 00:00:00",
        )
        .unwrap();
        let facts = DocFacts {
            kind: DocKind::Incoming,
            reg_number: reg,
            reg_date: "2026-01-20",
            counterparty: "НПО «Молния»",
            topic,
            signer: "",
            addressees: "",
            deadline_src: "",
            ref_: "",
        };
        repo::document::insert(conn, &facts, batch, "2026-01-01 00:00:00").unwrap();
    }

    #[test]
    fn theme_assigned_to_incoming_shows_in_view() {
        let conn = migrated();
        insert_incoming(&conn, "11006", "Ответ на исх.");
        repo::theme::assign(&conn, DocKind::Incoming, "11006", "Поставки").unwrap();

        let ctx = load(&conn, "2026-02-01".to_string()).unwrap();
        let v = build_view(&ctx, DocKind::Incoming, "11006").unwrap();
        // Тема входящего отражается в DocumentView.theme (реверс «темы только у исходящих»).
        assert_eq!(v.theme.as_deref(), Some("Поставки"));
        // Статуса у входящего по-прежнему нет (§3).
        assert!(v.status.is_none());
    }

    #[test]
    fn same_reg_number_outgoing_and_incoming_have_independent_themes() {
        let conn = migrated();
        // ОДИНАКОВЫЙ рег.номер у исходящего и входящего — ключ (kind, reg) исключает коллизию.
        insert_outgoing(&conn, "100/48", "Ваган", "Петров");
        insert_incoming(&conn, "100/48", "входящее с тем же номером");

        repo::theme::assign(&conn, DocKind::Outgoing, "100/48", "Исходящая тема").unwrap();
        repo::theme::assign(&conn, DocKind::Incoming, "100/48", "Входящая тема").unwrap();

        let ctx = load(&conn, "2026-02-01".to_string()).unwrap();
        let out = build_view(&ctx, DocKind::Outgoing, "100/48").unwrap();
        let inc = build_view(&ctx, DocKind::Incoming, "100/48").unwrap();
        assert_eq!(out.theme.as_deref(), Some("Исходящая тема"));
        assert_eq!(inc.theme.as_deref(), Some("Входящая тема"));
    }

    #[test]
    fn clear_theme_reverts_by_kind_and_reg() {
        let conn = migrated();
        insert_outgoing(&conn, "100/48", "Ваган", "Петров");
        insert_incoming(&conn, "100/48", "входящее");
        repo::theme::assign(&conn, DocKind::Outgoing, "100/48", "Тема").unwrap();
        repo::theme::assign(&conn, DocKind::Incoming, "100/48", "Тема").unwrap();

        // Снятие темы у входящего НЕ затрагивает исходящий с тем же номером.
        let removed = repo::theme::clear_assignment(&conn, DocKind::Incoming, "100/48").unwrap();
        assert!(removed);

        let ctx = load(&conn, "2026-02-01".to_string()).unwrap();
        assert!(build_view(&ctx, DocKind::Incoming, "100/48")
            .unwrap()
            .theme
            .is_none());
        assert_eq!(
            build_view(&ctx, DocKind::Outgoing, "100/48")
                .unwrap()
                .theme
                .as_deref(),
            Some("Тема")
        );

        // Повторное снятие того же (kind, reg) → false (уже снято).
        assert!(!repo::theme::clear_assignment(&conn, DocKind::Incoming, "100/48").unwrap());
    }

    #[test]
    fn deleted_theme_letters_become_no_theme() {
        let mut conn = migrated();
        insert_outgoing(&conn, "100/48", "Ваган", "Петров");
        insert_incoming(&conn, "100/48", "входящее");
        insert_outgoing(&conn, "100/49", "Ваган", "Петров");
        repo::theme::assign(&conn, DocKind::Outgoing, "100/48", "Тема").unwrap();
        repo::theme::assign(&conn, DocKind::Incoming, "100/48", "Тема").unwrap();
        repo::theme::assign(&conn, DocKind::Outgoing, "100/49", "Другая").unwrap();

        let status_before = effective(&conn, "100/48").status;
        assert_eq!(repo::theme::delete(&mut conn, "Тема").unwrap(), 2);

        let ctx = load(&conn, "2026-02-01".to_string()).unwrap();
        let out = build_view(&ctx, DocKind::Outgoing, "100/48").unwrap();
        // Письма удалённой темы — «Без темы» (theme = None), оба вида.
        assert!(out.theme.is_none());
        assert!(build_view(&ctx, DocKind::Incoming, "100/48")
            .unwrap()
            .theme
            .is_none());
        // Чужая тема цела, статус исходящего не изменился.
        assert_eq!(
            build_view(&ctx, DocKind::Outgoing, "100/49")
                .unwrap()
                .theme
                .as_deref(),
            Some("Другая")
        );
        assert_eq!(out.status, status_before);
    }
}
