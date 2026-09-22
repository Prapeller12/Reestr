// Репозитории поверх rusqlite (backend.md §1): только CRUD/запросы, без бизнес-правил.
// Все функции принимают &Connection (Transaction тоже подходит через deref-coercion).

pub mod deadline;
pub mod document;
pub mod field_override;
pub mod import;
pub mod link;
pub mod party;
pub mod theme;
