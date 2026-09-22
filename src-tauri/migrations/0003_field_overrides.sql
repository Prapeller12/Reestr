-- Миграция 0003 — правка полей Подписант/Адресаты (оверлей) + справочник участников.
-- АДДИТИВНАЯ: только CREATE TABLE, без rebuild/DROP существующих таблиц → данные и оверлей
-- (DOCUMENT/THEME/THEME_ASSIGNMENT/DEADLINE/LINK) не затрагиваются (КОНЦЕПЦИЯ §4.1).
-- FK на DOCUMENT НЕ ставим: ключ документа композитный (kind, reg_number), а оверлей исходящих
-- адресуется только reg_number — как THEME_ASSIGNMENT/DEADLINE после 0002 (без FK).
-- 0001/0002 не редактируются. PRAGMA — в коде (db.rs), не здесь.

-- Оверлей-правка одного поля исходящего документа (docs/КОНЦЕПЦИЯ-правка-полей.md §4).
-- field ∈ {'signer','addressees'}; реверт к факту = удаление строки. Приоритет: правка > выгрузка.
CREATE TABLE FIELD_OVERRIDE (
    doc_reg TEXT NOT NULL,             -- = reg_number исходящего (оверлей только исходящих)
    field   TEXT NOT NULL,             -- 'signer' | 'addressees'
    value   TEXT NOT NULL,             -- правленое значение (может быть '')
    set_at  TEXT NOT NULL,             -- ISO datetime
    PRIMARY KEY (doc_reg, field)
);

-- Справочник участников (docs/КОНЦЕПЦИЯ-правка-полей.md §3). Пополняется импортом (оба вида)
-- и ручной правкой сразу. Только пополняется (§6 инв.3). role ∈ {'signer','addressee'}.
CREATE TABLE PARTY_LIBRARY (
    value TEXT NOT NULL,
    role  TEXT NOT NULL,               -- 'signer' | 'addressee'
    PRIMARY KEY (value, role)
);
