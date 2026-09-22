// Импорт-слой (backend.md §6, §7): парсер выгрузки .txt и движок сверки new/same/changed.
// Не пишет в БД сам — отдаёт результат в командный слой.

pub mod diff;
pub mod parser;
