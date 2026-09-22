// API-слой (docs/plans/v2-backend.md §6 + батч 2 + QA-3 F4 удаление темы): 22 Tauri-команды. Единственная точка, которую видит фронт.
// Оркеструет domain + repo + import, собирает DTO, отдаёт Result<T, ApiError>.
//
// Соглашение об именах: JSON/JS — camelCase, Rust — snake_case. Tauri v2 маппит имена
// аргументов camelCase→snake_case автоматически (напр. regNumber → reg_number).
// Все мутирующие команды документа возвращают ПЕРЕСЧИТАННЫЙ DocumentView.

use std::sync::MutexGuard;

use rusqlite::Connection;
use tauri::State;

use crate::dto::{
    BulkAssignResult, DeleteThemeResult, DiffKind, DocKind, DocRef, DocStatus, DocumentView, ImportApplyResult,
    ImportBatchDto, ImportCounts, ImportDiffField, ImportDiffRow, ImportPreview, LetterMatch,
    PrintModel, RegistryFilters, RegistryGroup, RegistryResult, ThemeDto, TimelineItem,
    TimelineLane, TimelineResult,
};
use crate::error::ApiError;
use crate::import::{diff, parser};
use crate::model::{DocumentRecord, ImportBatchRecord};
use crate::repo;
use crate::state::AppState;
use crate::util::{now_datetime, today_iso};
use crate::view::{self, ViewContext};

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

fn lock<'a>(state: &'a State<'_, AppState>) -> Result<MutexGuard<'a, Connection>, ApiError> {
    state
        .db
        .lock()
        .map_err(|_| ApiError::db("База данных недоступна. Закройте программу и запустите заново."))
}

/// Строковый ключ статуса — для фильтра по статусу (совпадает с serde-сериализацией).
fn status_key(status: DocStatus) -> &'static str {
    match status {
        DocStatus::InWork => "inWork",
        DocStatus::Overdue => "overdue",
        DocStatus::Done => "done",
        DocStatus::Reworked => "reworked",
    }
}

fn contains_ci(haystack: &str, needle: &str) -> bool {
    haystack.to_lowercase().contains(&needle.to_lowercase())
}

/// Проверка документа фильтрами. Пустые значения фильтра игнорируются.
fn passes(view: &DocumentView, f: &RegistryFilters) -> bool {
    if let Some(kind) = f.kind.as_deref().filter(|s| !s.is_empty()) {
        if view.kind.as_str() != kind {
            return false;
        }
    }
    if let Some(theme) = f.theme.as_deref().filter(|s| !s.is_empty()) {
        if view.theme.as_deref() != Some(theme) {
            return false;
        }
    }
    if let Some(signer) = f.signer.as_deref().filter(|s| !s.is_empty()) {
        if !contains_ci(&view.signer, signer) {
            return false;
        }
    }
    if let Some(addr) = f.addressees.as_deref().filter(|s| !s.is_empty()) {
        if !contains_ci(&view.addressees, addr) {
            return false;
        }
    }
    if let Some(cp) = f.counterparty.as_deref().filter(|s| !s.is_empty()) {
        if !contains_ci(&view.counterparty, cp) {
            return false;
        }
    }
    if let Some(st) = f.status.as_deref().filter(|s| !s.is_empty()) {
        // Статус есть только у исходящих — входящие отсекаются фильтром по статусу.
        match view.status {
            Some(s) if status_key(s) == st => {}
            _ => return false,
        }
    }
    if let Some(q) = f.query.as_deref().filter(|s| !s.is_empty()) {
        let hit = contains_ci(&view.reg_number, q)
            || contains_ci(&view.topic, q)
            || contains_ci(&view.counterparty, q)
            || contains_ci(&view.signer, q)
            || contains_ci(&view.addressees, q)
            || contains_ci(&view.ref_, q);
        if !hit {
            return false;
        }
    }
    true
}

/// Отфильтрованные представления в детерминированном порядке (по reg_date, reg_number).
fn filtered_views(ctx: &ViewContext, f: &RegistryFilters) -> Vec<DocumentView> {
    ctx.order
        .iter()
        .filter_map(|(kind, reg)| view::build_view(ctx, *kind, reg))
        .filter(|v| passes(v, f))
        .collect()
}

/// Группировка по темам: именованные темы по алфавиту, «Без темы» (null) — последней.
fn group_views(views: Vec<DocumentView>) -> Vec<RegistryGroup> {
    use std::collections::BTreeMap;

    let mut named: BTreeMap<String, Vec<DocumentView>> = BTreeMap::new();
    let mut without: Vec<DocumentView> = Vec::new();

    for v in views {
        match v.theme.clone() {
            Some(theme) => named.entry(theme).or_default().push(v),
            None => without.push(v),
        }
    }

    let mut groups: Vec<RegistryGroup> = named
        .into_iter()
        .map(|(theme, documents)| RegistryGroup {
            theme: Some(theme),
            documents,
        })
        .collect();

    if !without.is_empty() {
        groups.push(RegistryGroup {
            theme: None,
            documents: without,
        });
    }
    groups
}

fn to_batch_dto(b: ImportBatchRecord) -> ImportBatchDto {
    ImportBatchDto {
        id: b.id,
        kind: b.kind,
        file_name: b.file_name,
        source: b.source,
        imported_at: b.imported_at,
        count_new: b.count_new,
        count_changed: b.count_changed,
        count_same: b.count_same,
    }
}

/// Пересчитать и вернуть DocumentView после мутации (в рамках уже взятого соединения).
fn recompute(conn: &Connection, kind: DocKind, reg_number: &str) -> Result<DocumentView, ApiError> {
    let ctx = view::load(conn, today_iso())?;
    view::build_view(&ctx, kind, reg_number)
        .ok_or_else(|| ApiError::not_found(format!("Письмо № {reg_number} не найдено в реестре.")))
}

// ---------------------------------------------------------------------------
// Реестр / карточка
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_registry(
    state: State<'_, AppState>,
    filters: Option<RegistryFilters>,
) -> Result<RegistryResult, ApiError> {
    let conn = lock(&state)?;
    let ctx = view::load(&conn, today_iso())?;
    let f = filters.unwrap_or_default();

    let views = filtered_views(&ctx, &f);
    let total = views.len();
    let groups = group_views(views);

    Ok(RegistryResult { groups, total })
}

#[tauri::command]
pub fn get_document(
    state: State<'_, AppState>,
    kind: DocKind,
    reg_number: String,
) -> Result<DocumentView, ApiError> {
    let conn = lock(&state)?;
    let ctx = view::load(&conn, today_iso())?;
    view::build_view(&ctx, kind, &reg_number)
        .ok_or_else(|| ApiError::not_found(format!("Письмо № {reg_number} не найдено в реестре.")))
}

// ---------------------------------------------------------------------------
// Импорт (по типу)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn import_preview(
    state: State<'_, AppState>,
    path: String,
    kind: DocKind,
) -> Result<ImportPreview, ApiError> {
    let conn = lock(&state)?;
    let rows = parser::parse_file(std::path::Path::new(&path), kind)?;

    let (mut n_new, mut n_same, mut n_changed) = (0usize, 0usize, 0usize);
    let mut out_rows = Vec::with_capacity(rows.len());

    for row in &rows {
        let existing = repo::document::get(&conn, kind, &row.reg_number)?;
        match diff::classify(row, existing.as_ref()) {
            diff::DiffClass::New => {
                n_new += 1;
                out_rows.push(ImportDiffRow {
                    reg_number: row.reg_number.clone(),
                    kind: DiffKind::New,
                    diff: None,
                });
            }
            diff::DiffClass::Same => {
                n_same += 1;
                out_rows.push(ImportDiffRow {
                    reg_number: row.reg_number.clone(),
                    kind: DiffKind::Same,
                    diff: None,
                });
            }
            diff::DiffClass::Changed(fields) => {
                n_changed += 1;
                out_rows.push(ImportDiffRow {
                    reg_number: row.reg_number.clone(),
                    kind: DiffKind::Changed,
                    diff: Some(
                        fields
                            .into_iter()
                            .map(|d| ImportDiffField {
                                field: d.field.to_string(),
                                old: d.old,
                                new_: d.new,
                            })
                            .collect(),
                    ),
                });
            }
        }
    }

    Ok(ImportPreview {
        counts: ImportCounts {
            new_: n_new,
            same: n_same,
            changed: n_changed,
        },
        rows: out_rows,
    })
}

#[tauri::command]
pub fn import_apply(
    state: State<'_, AppState>,
    path: String,
    kind: DocKind,
) -> Result<ImportApplyResult, ApiError> {
    let mut conn = lock(&state)?;

    // Источник истины — файл (не превью-снимок): парсим заново.
    let rows = parser::parse_file(std::path::Path::new(&path), kind)?;
    let file_name = std::path::Path::new(&path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let now = now_datetime();

    let tx = conn.transaction()?;
    // Batch-строка создаётся первой; помечена видом.
    let batch_id = repo::import::insert_batch(&tx, &file_name, "1C", kind, &now)?;

    let (mut n_new, mut n_same, mut n_changed) = (0i64, 0i64, 0i64);
    for row in &rows {
        // Справочник участников пополняется из ЛЮБОГО импортированного документа (§3):
        // signer (только исх.) → role signer, addressees (оба вида) → role addressee. Пустые skip.
        repo::party::collect_row(&tx, &row.signer, &row.addressees)?;

        let existing = repo::document::get(&tx, kind, &row.reg_number)?;
        match diff::classify(row, existing.as_ref()) {
            diff::DiffClass::New => {
                repo::document::insert(&tx, &row.as_facts(), batch_id, &now)?;
                n_new += 1;
            }
            diff::DiffClass::Changed(_) => {
                // Оверлей FIELD_OVERRIDE не трогаем: правка переживает переимпорт (§5a, §6 инв.1).
                repo::document::update_fields(&tx, &row.as_facts(), batch_id, &now)?;
                n_changed += 1;
            }
            diff::DiffClass::Same => {
                // SAME — не трогаем. Оверлей (LINK/THEME/DEADLINE/FIELD_OVERRIDE) не трогаем ни разу.
                n_same += 1;
            }
        }
    }

    repo::import::update_counts(&tx, batch_id, n_new, n_changed, n_same)?;
    let batch = repo::import::get_batch(&tx, batch_id)?
        .ok_or_else(|| ApiError::db("Не удалось сохранить импортированные записи. Повторите импорт."))?;
    tx.commit()?;

    Ok(ImportApplyResult {
        batch: to_batch_dto(batch),
        counts: ImportCounts {
            new_: n_new as usize,
            same: n_same as usize,
            changed: n_changed as usize,
        },
    })
}

#[tauri::command]
pub fn list_import_batches(state: State<'_, AppState>) -> Result<Vec<ImportBatchDto>, ApiError> {
    let conn = lock(&state)?;
    let batches = repo::import::list_batches(&conn)?;
    Ok(batches.into_iter().map(to_batch_dto).collect())
}

// ---------------------------------------------------------------------------
// Привязка письма (смена статуса, §5.5)
// ---------------------------------------------------------------------------

/// Поиск письма из базы для карточки (выпадающий список). Оба вида; из уже импортированных.
#[tauri::command]
pub fn search_letters(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<LetterMatch>, ApiError> {
    let conn = lock(&state)?;
    let ctx = view::load(&conn, today_iso())?;
    let q = query.trim();
    let lim = limit.unwrap_or(50);

    let mut matches: Vec<&DocumentRecord> = ctx
        .docs_by_key
        .values()
        .filter(|d| {
            q.is_empty()
                || contains_ci(&d.reg_number, q)
                || contains_ci(&d.topic, q)
                || contains_ci(&d.ref_, q)
        })
        .collect();
    // Детерминированный порядок: новые сверху, затем по номеру.
    matches.sort_by(|a, b| {
        b.reg_date
            .cmp(&a.reg_date)
            .then_with(|| a.reg_number.cmp(&b.reg_number))
    });

    let out = matches
        .into_iter()
        .take(lim)
        .map(|d| LetterMatch {
            reg_number: d.reg_number.clone(),
            kind: d.kind,
            topic: d.topic.clone(),
            reg_date: d.reg_date.clone(),
            ref_: d.ref_.clone(),
            status: view::status_of(&ctx, d.kind, &d.reg_number),
        })
        .collect();

    Ok(out)
}

/// Привязать письмо к исходящей задаче. Входящее → Выполнено, повторное исходящее → В доработке.
#[tauri::command]
pub fn attach_letter(
    state: State<'_, AppState>,
    task_reg: String,
    letter_reg: String,
    letter_kind: DocKind,
) -> Result<DocumentView, ApiError> {
    let conn = lock(&state)?;

    if !repo::document::exists(&conn, DocKind::Outgoing, &task_reg)? {
        return Err(ApiError::not_found(format!(
            "Исходящее письмо № {task_reg} не найдено в реестре."
        )));
    }
    // Письмо обязано существовать в базе — номер не выдумывается (§5.5).
    if !repo::document::exists(&conn, letter_kind, &letter_reg)? {
        return Err(ApiError::link_target(format!(
            "Письмо № {letter_reg} не найдено в реестре. Привязать можно только письмо из выгрузки."
        )));
    }

    let now = now_datetime();
    repo::link::add(&conn, &task_reg, &letter_reg, letter_kind, &now)?;

    recompute(&conn, DocKind::Outgoing, &task_reg)
}

/// Снять привязку письма от задачи.
#[tauri::command]
pub fn detach_letter(
    state: State<'_, AppState>,
    task_reg: String,
    letter_reg: String,
    letter_kind: DocKind,
) -> Result<DocumentView, ApiError> {
    let conn = lock(&state)?;
    if !repo::document::exists(&conn, DocKind::Outgoing, &task_reg)? {
        return Err(ApiError::not_found(format!(
            "Исходящее письмо № {task_reg} не найдено в реестре."
        )));
    }
    repo::link::detach(&conn, &task_reg, &letter_reg, letter_kind)?;
    recompute(&conn, DocKind::Outgoing, &task_reg)
}

// ---------------------------------------------------------------------------
// Сроки (оверлей исходящих)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn set_deadline(
    state: State<'_, AppState>,
    reg_number: String,
    end_date: String,
) -> Result<DocumentView, ApiError> {
    let conn = lock(&state)?;
    if !repo::document::exists(&conn, DocKind::Outgoing, &reg_number)? {
        return Err(ApiError::not_found(format!(
            "Исходящее письмо № {reg_number} не найдено в реестре."
        )));
    }
    // Валидация ISO 'YYYY-MM-DD'.
    if chrono::NaiveDate::parse_from_str(&end_date, "%Y-%m-%d").is_err() {
        return Err(ApiError::validation(format!(
            "Некорректный срок исполнения: «{end_date}»."
        )));
    }
    let now = now_datetime();
    repo::deadline::set(&conn, &reg_number, &end_date, &now)?;
    recompute(&conn, DocKind::Outgoing, &reg_number)
}

#[tauri::command]
pub fn clear_deadline(
    state: State<'_, AppState>,
    reg_number: String,
) -> Result<DocumentView, ApiError> {
    let conn = lock(&state)?;
    if !repo::document::exists(&conn, DocKind::Outgoing, &reg_number)? {
        return Err(ApiError::not_found(format!(
            "Исходящее письмо № {reg_number} не найдено в реестре."
        )));
    }
    repo::deadline::clear(&conn, &reg_number)?;
    recompute(&conn, DocKind::Outgoing, &reg_number)
}

// ---------------------------------------------------------------------------
// Правка полей Подписант/Адресаты + справочник участников (docs/КОНЦЕПЦИЯ-правка-полей.md)
// ---------------------------------------------------------------------------

/// Сохранить правку поля исходящего (оверлей «правка > факт», §5a). field = 'signer' | 'addressees'.
/// Значение trim-ится; пустое допустимо (правка «очистить поле»), в справочник пустое не идёт.
#[tauri::command]
pub fn set_field_override(
    state: State<'_, AppState>,
    reg_number: String,
    field: String,
    value: String,
) -> Result<DocumentView, ApiError> {
    let conn = lock(&state)?;
    // Правка — только у исходящих (§2): ключ оверлея = reg_number исходящего.
    if !repo::document::exists(&conn, DocKind::Outgoing, &reg_number)? {
        return Err(ApiError::not_found(format!(
            "Исходящее письмо № {reg_number} не найдено в реестре."
        )));
    }
    if !repo::field_override::is_valid_field(&field) {
        return Err(ApiError::validation(format!(
            "Недопустимое поле правки: «{field}» (ожидалось signer или addressees)"
        )));
    }
    let value = value.trim().to_string();
    let now = now_datetime();
    repo::field_override::set(&conn, &reg_number, &field, &value, &now)?;
    // Пополнить справочник сразу (§6 инв.5). signer→role signer, addressees→role addressee.
    if let Some(role) = repo::party::role_for_field(&field) {
        repo::party::collect(&conn, &value, role)?;
    }
    recompute(&conn, DocKind::Outgoing, &reg_number)
}

/// Снять правку поля (реверт к факту из выгрузки, §6 инв.2). field = 'signer' | 'addressees'.
#[tauri::command]
pub fn clear_field_override(
    state: State<'_, AppState>,
    reg_number: String,
    field: String,
) -> Result<DocumentView, ApiError> {
    let conn = lock(&state)?;
    if !repo::document::exists(&conn, DocKind::Outgoing, &reg_number)? {
        return Err(ApiError::not_found(format!(
            "Исходящее письмо № {reg_number} не найдено в реестре."
        )));
    }
    if !repo::field_override::is_valid_field(&field) {
        return Err(ApiError::validation(format!(
            "Недопустимое поле правки: «{field}» (ожидалось signer или addressees)"
        )));
    }
    repo::field_override::clear(&conn, &reg_number, &field)?;
    recompute(&conn, DocKind::Outgoing, &reg_number)
}

/// Автодополнение из справочника участников для роли. role = 'signer' | 'addressee'.
/// (Поле addressees соответствует роли addressee — см. repo::party::role_for_field.)
#[tauri::command]
pub fn get_field_suggestions(
    state: State<'_, AppState>,
    role: String,
) -> Result<Vec<String>, ApiError> {
    let conn = lock(&state)?;
    if !repo::party::is_valid_role(&role) {
        return Err(ApiError::validation(format!(
            "Недопустимая роль справочника: «{role}» (ожидалось signer или addressee)"
        )));
    }
    repo::party::list(&conn, &role)
}

// ---------------------------------------------------------------------------
// Темы (документы обоих видов; ключ оверлея — пара (вид, рег.номер), §5.6)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn assign_theme(
    state: State<'_, AppState>,
    kind: DocKind,
    reg_number: String,
    theme_name: String,
) -> Result<DocumentView, ApiError> {
    let conn = lock(&state)?;
    if !repo::document::exists(&conn, kind, &reg_number)? {
        return Err(ApiError::not_found(format!(
            "Письмо № {reg_number} ({}) не найдено в реестре.",
            kind.label()
        )));
    }
    // trim + пусто + служебное «Без темы» → VALIDATION_ERROR (QA-3 п.9, шаг 4б).
    let theme = repo::theme::validate_theme_name(&theme_name)?;
    repo::theme::assign(&conn, kind, &reg_number, theme)?;
    recompute(&conn, kind, &reg_number)
}

#[tauri::command]
pub fn bulk_assign_themes(
    state: State<'_, AppState>,
    items: Vec<DocRef>,
    theme_name: String,
) -> Result<BulkAssignResult, ApiError> {
    let mut conn = lock(&state)?;
    let theme = repo::theme::validate_theme_name(&theme_name)?.to_string();

    let tx = conn.transaction()?;
    repo::theme::ensure_theme(&tx, &theme)?;
    let mut updated = 0i64;
    for it in &items {
        if repo::document::exists(&tx, it.kind, &it.reg_number)? {
            repo::theme::assign(&tx, it.kind, &it.reg_number, &theme)?;
            updated += 1;
        }
    }
    tx.commit()?;

    Ok(BulkAssignResult { updated })
}

/// Снять тему с набора документов (любого вида). Оверлей-операция: удаляет THEME_ASSIGNMENT,
/// факты не трогает. Ключ — пара (вид, рег.номер).
#[tauri::command]
pub fn bulk_clear_themes(
    state: State<'_, AppState>,
    items: Vec<DocRef>,
) -> Result<BulkAssignResult, ApiError> {
    let mut conn = lock(&state)?;
    let tx = conn.transaction()?;
    let mut updated = 0i64;
    for it in &items {
        if repo::theme::clear_assignment(&tx, it.kind, &it.reg_number)? {
            updated += 1;
        }
    }
    tx.commit()?;

    Ok(BulkAssignResult { updated })
}

#[tauri::command]
pub fn create_theme(state: State<'_, AppState>, name: String) -> Result<ThemeDto, ApiError> {
    let conn = lock(&state)?;
    let name = repo::theme::validate_theme_name(&name)?;
    repo::theme::create_theme(&conn, name)?;
    Ok(ThemeDto {
        name: name.to_string(),
        user_created: true,
        document_count: 0,
    })
}

/// Удалить тему. Письма темы (оба вида) → «Без темы»; факты, привязки, сроки и правки полей
/// не трогаются (КОНЦЕПЦИЯ §5.6). Нет темы → NOT_FOUND, пустое имя → VALIDATION_ERROR.
#[tauri::command]
pub fn delete_theme(
    state: State<'_, AppState>,
    name: String,
) -> Result<DeleteThemeResult, ApiError> {
    let mut conn = lock(&state)?;
    let reassigned = repo::theme::delete(&mut conn, &name)?;
    Ok(DeleteThemeResult { reassigned })
}

#[tauri::command]
pub fn list_themes(state: State<'_, AppState>) -> Result<Vec<ThemeDto>, ApiError> {
    let conn = lock(&state)?;
    let rows = repo::theme::list_with_counts(&conn)?;
    Ok(rows
        .into_iter()
        .map(|t| ThemeDto {
            name: t.name,
            user_created: t.user_created,
            document_count: t.document_count,
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Таймлайн / сверка / печать
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_timeline(
    state: State<'_, AppState>,
    filters: Option<RegistryFilters>,
) -> Result<TimelineResult, ApiError> {
    use std::collections::BTreeMap;

    let conn = lock(&state)?;
    let ctx = view::load(&conn, today_iso())?;
    let f = filters.unwrap_or_default();

    let views = filtered_views(&ctx, &f);

    let mut named: BTreeMap<String, Vec<TimelineItem>> = BTreeMap::new();
    let mut without: Vec<TimelineItem> = Vec::new();

    for v in views {
        // Таймлайн — только исходящие (у них есть статус и срок).
        let (Some(status), Some(due)) = (v.status, v.due_date.clone()) else {
            continue;
        };
        let item = TimelineItem {
            reg_number: v.reg_number.clone(),
            reg_date: v.reg_date.clone(),
            due_date: due,
            status,
        };
        match v.theme {
            Some(theme) => named.entry(theme).or_default().push(item),
            None => without.push(item),
        }
    }

    let mut lanes: Vec<TimelineLane> = named
        .into_iter()
        .map(|(theme, items)| TimelineLane {
            theme: Some(theme),
            items,
        })
        .collect();
    if !without.is_empty() {
        lanes.push(TimelineLane {
            theme: None,
            items: without,
        });
    }

    Ok(TimelineResult { lanes })
}

/// Сверка «в системе vs импорт» (§6 Сверка). Переиспользует форму import_preview.
///
/// ПРИМЕЧАНИЕ: raw-снимок выгрузки не хранится, поэтому полевой diff {old,new} задним числом
/// восстановить нельзя. Возвращаем счётчики батча и список его документов с эвристикой:
/// created_at == updated_at → new (вставлен и не менялся), иначе changed.
#[tauri::command]
pub fn get_compare(
    state: State<'_, AppState>,
    batch_id: Option<i64>,
) -> Result<ImportPreview, ApiError> {
    let conn = lock(&state)?;

    let id = match batch_id {
        Some(i) => i,
        None => repo::import::latest_batch_id(&conn)?
            .ok_or_else(|| ApiError::not_found("Импортов ещё не было. Загрузите выгрузку из 1С."))?,
    };
    let batch = repo::import::get_batch(&conn, id)?
        .ok_or_else(|| ApiError::not_found(format!("Импорт № {id} не найден.")))?;

    let docs = repo::import::docs_in_batch(&conn, id)?;
    let rows = docs
        .into_iter()
        .map(|d| ImportDiffRow {
            reg_number: d.reg_number,
            kind: if d.created_at == d.updated_at {
                DiffKind::New
            } else {
                DiffKind::Changed
            },
            diff: None,
        })
        .collect();

    Ok(ImportPreview {
        counts: ImportCounts {
            new_: batch.count_new as usize,
            same: batch.count_same as usize,
            changed: batch.count_changed as usize,
        },
        rows,
    })
}

#[tauri::command]
pub fn get_print_model(
    state: State<'_, AppState>,
    filters: Option<RegistryFilters>,
) -> Result<PrintModel, ApiError> {
    let conn = lock(&state)?;
    let ctx = view::load(&conn, today_iso())?;
    let f = filters.unwrap_or_default();

    let views = filtered_views(&ctx, &f);
    let groups = group_views(views);

    Ok(PrintModel {
        generated_at: now_datetime(),
        groups,
    })
}
