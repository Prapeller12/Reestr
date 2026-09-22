// Источник времени — системная локальная дата ОС (backend.md §8). Единственная точка,
// откуда берётся «сегодня» и таймстампы created_at/updated_at/imported_at/set_at.

use chrono::Local;

/// «Сегодня» в ISO 'YYYY-MM-DD'.
pub fn today_iso() -> String {
    Local::now().date_naive().format("%Y-%m-%d").to_string()
}

/// Локальная отметка времени 'YYYY-MM-DD HH:MM:SS'.
pub fn now_datetime() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}
