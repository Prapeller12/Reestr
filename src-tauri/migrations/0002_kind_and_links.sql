-- Миграция 0002 — вид документа (kind), поля counterparty/deadline_src, обобщённые привязки.
-- СТРОГО с сохранением данных (КОНЦЕПЦИЯ §4.1): rebuild = create new + copy + drop + rename;
-- DROP выполняется ТОЛЬКО ПОСЛЕ полного копирования строк — это НЕ потеря данных.
-- PRAGMA foreign_keys выключается раннером (db.rs) на время миграции — нельзя менять внутри
-- транзакции, а rebuild родителя (DOCUMENT) при включённых FK ломает детей.
-- 0001 не редактируется.

-- 1) IMPORT_BATCH — аддитивно: помечаем вид. Старые батчи → outgoing.
ALTER TABLE IMPORT_BATCH ADD COLUMN kind TEXT NOT NULL DEFAULT 'outgoing';

-- 2) DOCUMENT — rebuild под композитный ключ (kind, reg_number).
--    recipient → counterparty; +deadline_src (пусто для перенесённых исходящих).
CREATE TABLE DOCUMENT_NEW (
    kind            TEXT    NOT NULL,                 -- 'outgoing' | 'incoming'
    reg_number      TEXT    NOT NULL,
    reg_date        TEXT    NOT NULL,
    counterparty    TEXT    NOT NULL DEFAULT '',
    topic           TEXT    NOT NULL DEFAULT '',
    signer          TEXT    NOT NULL DEFAULT '',
    addressees      TEXT    NOT NULL DEFAULT '',
    deadline_src    TEXT    NOT NULL DEFAULT '',
    ref             TEXT    NOT NULL DEFAULT '',
    import_batch_id INTEGER NOT NULL REFERENCES IMPORT_BATCH(id),
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL,
    PRIMARY KEY (kind, reg_number)
);
INSERT INTO DOCUMENT_NEW
    (kind, reg_number, reg_date, counterparty, topic, signer, addressees, deadline_src, ref,
     import_batch_id, created_at, updated_at)
SELECT 'outgoing', reg_number, reg_date, recipient, topic, signer, addressees, '', ref,
     import_batch_id, created_at, updated_at
FROM DOCUMENT;
DROP TABLE DOCUMENT;
ALTER TABLE DOCUMENT_NEW RENAME TO DOCUMENT;
CREATE INDEX idx_document_batch ON DOCUMENT(import_batch_id);
CREATE INDEX idx_document_ref   ON DOCUMENT(ref);

-- 3) LINK — обобщение: привязка письма к задаче (0..* на задачу). Перенос старых ссылок
--    best-effort по DOCUMENT.ref (в v1 все документы = outgoing).
CREATE TABLE LINK_NEW (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_reg    TEXT NOT NULL,
    letter_reg  TEXT NOT NULL,
    letter_kind TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE (task_reg, letter_reg, letter_kind)
);
INSERT OR IGNORE INTO LINK_NEW (task_reg, letter_reg, letter_kind, created_at)
SELECT l.doc_reg, d.reg_number, 'outgoing', l.created_at
FROM LINK l
JOIN DOCUMENT d ON d.ref = l.target_ref AND d.kind = 'outgoing';
DROP TABLE LINK;
ALTER TABLE LINK_NEW RENAME TO LINK;
CREATE INDEX idx_link_task   ON LINK(task_reg);
CREATE INDEX idx_link_letter ON LINK(letter_reg);

-- 4) THEME_ASSIGNMENT — rebuild: снять невалидный FK на DOCUMENT(reg_number) (ключ теперь
--    композитный). Темы — оверлей только исходящих; FK theme_name → THEME сохраняем.
CREATE TABLE THEME_ASSIGNMENT_NEW (
    doc_reg    TEXT PRIMARY KEY,
    theme_name TEXT NOT NULL REFERENCES THEME(name)
);
INSERT INTO THEME_ASSIGNMENT_NEW (doc_reg, theme_name)
SELECT doc_reg, theme_name FROM THEME_ASSIGNMENT;
DROP TABLE THEME_ASSIGNMENT;
ALTER TABLE THEME_ASSIGNMENT_NEW RENAME TO THEME_ASSIGNMENT;
CREATE INDEX idx_theme_assignment_theme ON THEME_ASSIGNMENT(theme_name);

-- 5) DEADLINE — rebuild: снять невалидный FK на DOCUMENT(reg_number). Оверлей исходящих.
CREATE TABLE DEADLINE_NEW (
    doc_reg  TEXT PRIMARY KEY,
    end_date TEXT NOT NULL,
    set_at   TEXT NOT NULL
);
INSERT INTO DEADLINE_NEW (doc_reg, end_date, set_at)
SELECT doc_reg, end_date, set_at FROM DEADLINE;
DROP TABLE DEADLINE;
ALTER TABLE DEADLINE_NEW RENAME TO DEADLINE;
