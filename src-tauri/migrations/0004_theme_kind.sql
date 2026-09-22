-- Миграция 0004 — темы назначаются документам ОБОИХ видов (реверс «темы только у исходящих»).
-- Ключ тема-оверлея становится ПАРОЙ (kind, doc_reg): рег.номер уникален лишь в пределах вида
-- (КОНЦЕПЦИЯ §5.6), поэтому исходящий и входящий с одинаковым номером получают независимые темы.
-- СТРОГО с сохранением данных (КОНЦЕПЦИЯ §4.1): rebuild = create new + copy + drop + rename;
-- DROP выполняется ТОЛЬКО ПОСЛЕ полного копирования строк — это НЕ потеря данных.
-- Существующие назначения — это исходящие (до 0004 темы были только у них) → при копировании
-- проставляем kind='outgoing'. FK theme_name → THEME сохраняем. PRAGMA foreign_keys выключается
-- раннером (db.rs) на время миграции. 0001/0002/0003 не редактируются.

-- THEME_ASSIGNMENT — rebuild под композитный ключ (kind, doc_reg).
CREATE TABLE THEME_ASSIGNMENT_NEW (
    kind       TEXT NOT NULL,                 -- 'outgoing' | 'incoming'
    doc_reg    TEXT NOT NULL,
    theme_name TEXT NOT NULL REFERENCES THEME(name),
    PRIMARY KEY (kind, doc_reg)
);
INSERT INTO THEME_ASSIGNMENT_NEW (kind, doc_reg, theme_name)
SELECT 'outgoing', doc_reg, theme_name FROM THEME_ASSIGNMENT;
DROP TABLE THEME_ASSIGNMENT;
ALTER TABLE THEME_ASSIGNMENT_NEW RENAME TO THEME_ASSIGNMENT;
CREATE INDEX idx_theme_assignment_theme ON THEME_ASSIGNMENT(theme_name);
