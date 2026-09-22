// Serde-DTO — ДОСЛОВНОЕ зеркало src/api/types.ts (docs/plans/v2-backend.md §6).
// Все структуры сериализуются в camelCase; enum'ы — outgoing|incoming, inWork|overdue|done|reworked,
// red|amber|none, new|same|changed. Любое изменение здесь идёт вслед за §6, не наоборот.

use serde::{Deserialize, Serialize};

/// Вид документа (§2). Сериализуется в outgoing|incoming.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "camelCase")]
pub enum DocKind {
    Outgoing,
    Incoming,
}

impl DocKind {
    pub fn as_str(self) -> &'static str {
        match self {
            DocKind::Outgoing => "outgoing",
            DocKind::Incoming => "incoming",
        }
    }
    pub fn from_str(s: &str) -> Option<DocKind> {
        match s {
            "outgoing" => Some(DocKind::Outgoing),
            "incoming" => Some(DocKind::Incoming),
            _ => None,
        }
    }
    /// Русская подпись вида — ТОЛЬКО для текстов ошибок, видимых пользователю.
    /// Согласована со словом «письмо» (ср. род). В SQL и на фронт по-прежнему идёт as_str().
    pub fn label(self) -> &'static str {
        match self {
            DocKind::Outgoing => "исходящее",
            DocKind::Incoming => "входящее",
        }
    }
}

/// Статус документа (только у исходящих). Сериализуется в inWork|overdue|done|reworked.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum DocStatus {
    InWork,
    Overdue,
    Done,
    Reworked,
}

/// Уровень тревожности плашки. Сериализуется в red|amber|none.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum AlertLevel {
    Red,
    Amber,
    None,
}

/// Привязанное к задаче письмо (AttachedLetter) — для карточки исходящего.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AttachedLetter {
    pub id: i64,
    pub letter_reg: String,
    pub letter_kind: DocKind,
    pub letter_topic: String,
    #[serde(rename = "letterRef")]
    pub letter_ref: String,
    pub letter_status: Option<DocStatus>,
    pub created_at: String,
}

/// Кандидат письма для привязки (search_letters / выпадающий список §5.5).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LetterMatch {
    pub reg_number: String,
    pub kind: DocKind,
    pub topic: String,
    pub reg_date: String,
    #[serde(rename = "ref")]
    pub ref_: String,
    pub status: Option<DocStatus>,
}

/// Узел цепочки (ChainNode) — сокращённая форма документа любого вида:
/// задача-исходящее со статусом либо входящее письмо, которым задача закрыта (status = None).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChainNode {
    pub reg_number: String,
    pub kind: DocKind,
    #[serde(rename = "ref")]
    pub ref_: String,
    pub topic: String,
    pub status: Option<DocStatus>,
}

/// Цепочка в обе стороны: повторные исходящие + замыкающие входящие.
#[derive(Serialize, Debug)]
pub struct Chain {
    pub predecessors: Vec<ChainNode>,
    pub successors: Vec<ChainNode>,
}

/// Главный DTO — зеркало DocumentView из types.ts. Статус-блок опционален (у входящих = null).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocumentView {
    pub reg_number: String,
    pub kind: DocKind,
    pub reg_date: String,
    pub counterparty: String,
    pub topic: String,
    pub signer: String,
    pub addressees: String,
    /// Правил ли пользователь поле signer (есть FIELD_OVERRIDE). Всегда false у входящих.
    pub signer_edited: bool,
    /// Правил ли пользователь поле addressees (есть FIELD_OVERRIDE). Всегда false у входящих.
    pub addressees_edited: bool,
    #[serde(rename = "ref")]
    pub ref_: String,
    pub deadline_src: String,
    pub status: Option<DocStatus>,
    pub status_label: Option<String>,
    pub due_date: Option<String>,
    pub days_remaining: Option<i64>,
    pub alert_level: Option<AlertLevel>,
    pub remaining_text: Option<String>,
    pub theme: Option<String>,
    pub links: Vec<AttachedLetter>,
    pub chain: Chain,
}

/// Фильтры реестра/таймлайна — все поля опциональны (§6).
#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RegistryFilters {
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub signer: Option<String>,
    #[serde(default)]
    pub addressees: Option<String>,
    #[serde(default)]
    pub counterparty: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub query: Option<String>,
}

/// Ссылка на документ (вид + рег.номер) — ключ тема-оверлея для bulk-операций.
/// Рег.номер уникален лишь в пределах вида (§5.6), поэтому вид обязателен.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocRef {
    pub kind: DocKind,
    pub reg_number: String,
}

/// Группа реестра по теме (theme=null → «Без темы»; входящие всегда сюда).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RegistryGroup {
    pub theme: Option<String>,
    pub documents: Vec<DocumentView>,
}

/// Ответ get_registry.
#[derive(Serialize, Debug)]
pub struct RegistryResult {
    pub groups: Vec<RegistryGroup>,
    pub total: usize,
}

/// Счётчики импорта. Поля { new, same, changed } — `new` требует rename (ключевое слово Rust).
#[derive(Serialize, Debug)]
pub struct ImportCounts {
    #[serde(rename = "new")]
    pub new_: usize,
    pub same: usize,
    pub changed: usize,
}

/// Класс строки в diff-превью.
#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub enum DiffKind {
    New,
    Same,
    Changed,
}

/// Одно изменившееся поле (для CHANGED).
#[derive(Serialize, Debug)]
pub struct ImportDiffField {
    pub field: String,
    pub old: String,
    #[serde(rename = "new")]
    pub new_: String,
}

/// Строка diff-превью. diff присутствует только для CHANGED.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportDiffRow {
    pub reg_number: String,
    pub kind: DiffKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<Vec<ImportDiffField>>,
}

/// Ответ import_preview / get_compare (одна модель diff).
#[derive(Serialize, Debug)]
pub struct ImportPreview {
    pub counts: ImportCounts,
    pub rows: Vec<ImportDiffRow>,
}

/// Строка истории импортов (ImportBatchDto). kind — вид выгрузки.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatchDto {
    pub id: i64,
    pub kind: DocKind,
    pub file_name: String,
    pub source: String,
    pub imported_at: String,
    pub count_new: i64,
    pub count_changed: i64,
    pub count_same: i64,
}

/// Ответ import_apply.
#[derive(Serialize, Debug)]
pub struct ImportApplyResult {
    pub batch: ImportBatchDto,
    pub counts: ImportCounts,
}

/// Тема + счётчик (ThemeDto).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ThemeDto {
    pub name: String,
    pub user_created: bool,
    pub document_count: i64,
}

/// Элемент таймлайна (только исходящие).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TimelineItem {
    pub reg_number: String,
    pub reg_date: String,
    pub due_date: String,
    pub status: DocStatus,
}

/// Дорожка таймлайна по теме.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TimelineLane {
    pub theme: Option<String>,
    pub items: Vec<TimelineItem>,
}

/// Ответ get_timeline.
#[derive(Serialize, Debug)]
pub struct TimelineResult {
    pub lanes: Vec<TimelineLane>,
}

/// Модель печатной формы (get_print_model).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrintModel {
    pub generated_at: String,
    pub groups: Vec<RegistryGroup>,
}

/// Ответ bulk_assign_themes / bulk_clear_themes.
#[derive(Serialize, Debug)]
pub struct BulkAssignResult {
    pub updated: i64,
}

/// Ответ delete_theme: сколько писем (оба вида) перешло в «Без темы».
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeleteThemeResult {
    pub reassigned: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Сторож против путаницы двух подписей вида: as_str() — ключ для SQL и serde,
    /// label() — русский текст для ошибок. Подмена одного другим ломает либо базу, либо тексты.
    #[test]
    fn doc_kind_label_is_russian_and_as_str_is_the_wire_key() {
        assert_eq!(DocKind::Outgoing.as_str(), "outgoing");
        assert_eq!(DocKind::Incoming.as_str(), "incoming");
        assert_eq!(DocKind::Outgoing.label(), "исходящее");
        assert_eq!(DocKind::Incoming.label(), "входящее");
        for k in [DocKind::Outgoing, DocKind::Incoming] {
            assert!(!k.label().is_ascii(), "подпись вида должна быть русской");
            assert_eq!(DocKind::from_str(k.as_str()), Some(k));
        }
    }
}
