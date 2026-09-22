-- Миграция 0001 — начальная схема (FROZEN, backend.md §2.1).
-- ВНИМАНИЕ: PRAGMA (journal_mode=WAL, foreign_keys=ON, synchronous=NORMAL)
-- выставляются В КОДЕ на каждом соединении (src/db.rs), а НЕ здесь:
-- journal_mode нельзя менять внутри транзакции миграции. Этот файл — только DDL.

-- Факты из 1С -------------------------------------------------------------
CREATE TABLE IMPORT_BATCH (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name     TEXT    NOT NULL,
    source        TEXT    NOT NULL DEFAULT '1C',
    imported_at   TEXT    NOT NULL,                 -- ISO datetime
    count_new     INTEGER NOT NULL DEFAULT 0,
    count_changed INTEGER NOT NULL DEFAULT 0,
    count_same    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE DOCUMENT (
    reg_number      TEXT    PRIMARY KEY,             -- ключ '100/48'
    reg_date        TEXT    NOT NULL,                -- ISO 'YYYY-MM-DD'
    recipient       TEXT    NOT NULL DEFAULT '',     -- сырой текст ячейки (без split)
    topic           TEXT    NOT NULL DEFAULT '',     -- trimmed
    signer          TEXT    NOT NULL DEFAULT '',
    addressees      TEXT    NOT NULL DEFAULT '',     -- бывает пустым (''), не NULL
    ref             TEXT    NOT NULL DEFAULT '',
    import_batch_id INTEGER NOT NULL REFERENCES IMPORT_BATCH(id),
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL
);
CREATE INDEX idx_document_batch ON DOCUMENT(import_batch_id);

-- Пользовательский оверлей (импорт НЕ трогает) ----------------------------
CREATE TABLE THEME (
    name         TEXT    PRIMARY KEY,
    user_created INTEGER NOT NULL DEFAULT 1          -- 0/1
);

CREATE TABLE THEME_ASSIGNMENT (
    doc_reg    TEXT PRIMARY KEY REFERENCES DOCUMENT(reg_number),
    theme_name TEXT NOT NULL   REFERENCES THEME(name)
);
CREATE INDEX idx_theme_assignment_theme ON THEME_ASSIGNMENT(theme_name);

CREATE TABLE DEADLINE (
    doc_reg  TEXT PRIMARY KEY REFERENCES DOCUMENT(reg_number),
    end_date TEXT NOT NULL,                          -- ISO 'YYYY-MM-DD'
    set_at   TEXT NOT NULL
);

CREATE TABLE LINK (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_reg     TEXT NOT NULL REFERENCES DOCUMENT(reg_number),
    target_ref  TEXT NOT NULL,                       -- на какую строку реестра указывает
    linked_date TEXT NOT NULL,                       -- ISO 'YYYY-MM-DD', ставит бэкенд (§8)
    created_at  TEXT NOT NULL,
    UNIQUE(doc_reg)                                  -- 0..1 привязка на документ
);
CREATE INDEX idx_link_target ON LINK(target_ref);    -- обратный обход цепочек
