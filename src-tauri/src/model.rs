// Доменные записи (plain data) — общий язык между repo/, domain/, view/, import/.
// Не путать с DTO (dto.rs): это внутренние строки БД, DTO — то, что уходит на фронт.

use crate::dto::DocKind;

/// Строка таблицы DOCUMENT (импортированный факт). Ключ — пара (kind, reg_number).
#[derive(Clone, Debug)]
pub struct DocumentRecord {
    pub kind: DocKind,
    pub reg_number: String,
    pub reg_date: String,
    pub counterparty: String,
    pub topic: String,
    pub signer: String,
    pub addressees: String,
    pub deadline_src: String,
    pub ref_: String,
    pub import_batch_id: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Заимствованный срез фактов документа — вход для INSERT/UPDATE (repo не зависит от import/).
pub struct DocFacts<'a> {
    pub kind: DocKind,
    pub reg_number: &'a str,
    pub reg_date: &'a str,
    pub counterparty: &'a str,
    pub topic: &'a str,
    pub signer: &'a str,
    pub addressees: &'a str,
    pub deadline_src: &'a str,
    pub ref_: &'a str,
}

/// Строка таблицы LINK (привязка письма к задаче, 0..* на задачу).
#[derive(Clone, Debug)]
pub struct LinkRecord {
    pub id: i64,
    pub task_reg: String,
    pub letter_reg: String,
    pub letter_kind: DocKind,
    pub created_at: String,
}

/// Строка таблицы IMPORT_BATCH (история импортов, помечена видом).
#[derive(Clone, Debug)]
pub struct ImportBatchRecord {
    pub id: i64,
    pub kind: DocKind,
    pub file_name: String,
    pub source: String,
    pub imported_at: String,
    pub count_new: i64,
    pub count_changed: i64,
    pub count_same: i64,
}

/// Тема + число назначений (для list_themes).
#[derive(Clone, Debug)]
pub struct ThemeRow {
    pub name: String,
    pub user_created: bool,
    pub document_count: i64,
}
