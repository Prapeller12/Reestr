// Единая модель ошибок (backend.md §10.3). На фронт Tauri отдаёт РОВНО объект
// { "code": "...", "message": "..." } — потому что ApiError: Serialize с этими полями.
// code — машиночитаемый (ветвление на фронте), message — русский текст для пользователя.

use std::fmt;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

impl ApiError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }

    // Коды парсера (§6.2).
    pub fn parse_header(message: impl Into<String>) -> Self {
        Self::new("PARSE_HEADER", message)
    }
    pub fn parse_fields(message: impl Into<String>) -> Self {
        Self::new("PARSE_FIELDS", message)
    }
    pub fn parse_date(message: impl Into<String>) -> Self {
        Self::new("PARSE_DATE", message)
    }
    pub fn io(message: impl Into<String>) -> Self {
        Self::new("IO_ERROR", message)
    }

    // Коды прикладного слоя (§10.3).
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("NOT_FOUND", message)
    }
    pub fn validation(message: impl Into<String>) -> Self {
        Self::new("VALIDATION_ERROR", message)
    }
    pub fn link_target(message: impl Into<String>) -> Self {
        Self::new("LINK_TARGET_NOT_IN_REGISTRY", message)
    }
    pub fn duplicate_theme(message: impl Into<String>) -> Self {
        Self::new("DUPLICATE_THEME", message)
    }
    pub fn db(message: impl Into<String>) -> Self {
        Self::new("DB_ERROR", message)
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for ApiError {}

// Любая ошибка rusqlite → DB_ERROR; ошибка I/O → IO_ERROR.
impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> Self {
        ApiError::db(format!(
            "Не удалось обратиться к базе данных. Закройте программу и запустите заново. Подробности: {e}"
        ))
    }
}

impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self {
        ApiError::io(format!(
            "Не удалось прочитать или записать файл. Проверьте, что папка программы доступна для записи. Подробности: {e}"
        ))
    }
}
