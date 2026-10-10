-- One administrator; password is stored only as a salted Argon2id hash.
CREATE TABLE APP_ADMIN (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL
);
