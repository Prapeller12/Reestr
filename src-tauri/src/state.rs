use crate::{
    error::ApiError,
    network::store::{copy_connection, Head, Store},
};
use argon2::{
    password_hash::{rand_core::OsRng, SaltString},
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessStatus {
    pub role: String,
    pub initialized: bool,
    pub network: bool,
    pub revision: Option<String>,
}
struct Inner {
    conn: Connection,
    head: Option<Head>,
    admin_hash: Option<String>,
    failures: u32,
    blocked_until: Option<Instant>,
}
pub struct AppState {
    inner: Mutex<Inner>,
    pub store: Store,
    pub network: bool,
}
fn forbidden() -> ApiError {
    ApiError::new("FORBIDDEN", "Доступ только для администратора. Войдите как администратор, чтобы импортировать или изменять письма.")
}
fn password_hash(conn: &Connection) -> Result<Option<String>, ApiError> {
    Ok(conn
        .query_row(
            "SELECT password_hash FROM APP_ADMIN WHERE id=1",
            [],
            |row| row.get(0),
        )
        .optional()?)
}
impl AppState {
    pub fn open(
        root: PathBuf,
        local: PathBuf,
        seed: PathBuf,
        network: bool,
    ) -> Result<Self, ApiError> {
        std::fs::create_dir_all(&local)?;
        let store = Store { root, local, seed };
        let head = store.head()?;
        let conn = store.load(head.as_ref())?;
        Ok(Self {
            inner: Mutex::new(Inner {
                conn,
                head,
                admin_hash: None,
                failures: 0,
                blocked_until: None,
            }),
            store,
            network,
        })
    }
    fn lock(&self) -> Result<MutexGuard<'_, Inner>, ApiError> {
        self.inner
            .lock()
            .map_err(|_| ApiError::db("Состояние приложения недоступно. Перезапустите программу."))
    }
    fn refresh(&self, inner: &mut Inner) -> Result<(), ApiError> {
        let head = self.store.head()?;
        if inner.head.as_ref().map(|h| &h.revision) != head.as_ref().map(|h| &h.revision) {
            inner.conn = self.store.load(head.as_ref())?;
            inner.head = head;
        }
        if inner.admin_hash.is_some() && inner.admin_hash != password_hash(&inner.conn)? {
            inner.admin_hash = None;
        }
        Ok(())
    }
    fn status(&self, inner: &Inner) -> Result<AccessStatus, ApiError> {
        Ok(AccessStatus {
            role: if inner.admin_hash.is_some() {
                "admin"
            } else {
                "viewer"
            }
            .into(),
            initialized: password_hash(&inner.conn)?.is_some(),
            network: self.network,
            revision: inner.head.as_ref().map(|h| h.revision.clone()),
        })
    }
    pub fn access(&self) -> Result<AccessStatus, ApiError> {
        let mut inner = self.lock()?;
        self.refresh(&mut inner)?;
        self.status(&inner)
    }
    pub fn read<T>(
        &self,
        op: impl FnOnce(&mut Connection) -> Result<T, ApiError>,
    ) -> Result<T, ApiError> {
        let mut inner = self.lock()?;
        self.refresh(&mut inner)?;
        op(&mut inner.conn)
    }
    pub fn admin_read<T>(
        &self,
        op: impl FnOnce(&mut Connection) -> Result<T, ApiError>,
    ) -> Result<T, ApiError> {
        let mut inner = self.lock()?;
        self.refresh(&mut inner)?;
        if inner.admin_hash.is_none() {
            return Err(forbidden());
        }
        op(&mut inner.conn)
    }
    pub fn write<T>(
        &self,
        op: impl FnOnce(&mut Connection) -> Result<T, ApiError>,
    ) -> Result<T, ApiError> {
        let mut inner = self.lock()?;
        if inner.admin_hash.is_none() {
            return Err(forbidden());
        }
        let _writer = self.store.lock_writer()?;
        self.refresh(&mut inner)?;
        if inner.admin_hash.is_none() {
            return Err(forbidden());
        }
        let mut candidate = Connection::open_in_memory()?;
        copy_connection(&inner.conn, &mut candidate)?;
        candidate.execute_batch("PRAGMA foreign_keys=ON;")?;
        let result = op(&mut candidate)?;
        let head = self.store.publish(&candidate)?;
        inner.conn = candidate;
        inner.head = Some(head);
        Ok(result)
    }
    pub fn setup_admin(&self, password: &str) -> Result<AccessStatus, ApiError> {
        if password.chars().count() < 10 || password.len() > 256 {
            return Err(ApiError::validation(
                "Пароль должен содержать от 10 символов и занимать не более 256 байт.",
            ));
        }
        let mut inner = self.lock()?;
        let _writer = self.store.lock_writer()?;
        self.refresh(&mut inner)?;
        if password_hash(&inner.conn)?.is_some() {
            return Err(ApiError::new(
                "ADMIN_EXISTS",
                "Администратор уже настроен. Используйте вход по паролю.",
            ));
        }
        let hash = Argon2::default()
            .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
            .map_err(|_| ApiError::db("Не удалось защитить пароль."))?
            .to_string();
        let mut candidate = Connection::open_in_memory()?;
        copy_connection(&inner.conn, &mut candidate)?;
        candidate.execute(
            "INSERT INTO APP_ADMIN(id,password_hash) VALUES(1,?1)",
            [&hash],
        )?;
        let head = self.store.publish(&candidate)?;
        inner.conn = candidate;
        inner.head = Some(head);
        inner.admin_hash = Some(hash);
        self.status(&inner)
    }
    pub fn login(&self, password: &str) -> Result<AccessStatus, ApiError> {
        let mut inner = self.lock()?;
        self.refresh(&mut inner)?;
        if inner.blocked_until.is_some_and(|t| Instant::now() < t) {
            return Err(ApiError::new(
                "LOGIN_THROTTLED",
                "Слишком много попыток входа. Подождите 30 секунд.",
            ));
        }
        let hash = password_hash(&inner.conn)?
            .ok_or_else(|| ApiError::new("SETUP_REQUIRED", "Администратор ещё не настроен."))?;
        let parsed = PasswordHash::new(&hash)
            .map_err(|_| ApiError::db("Повреждена запись администратора."))?;
        if password.len() > 256
            || Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_err()
        {
            inner.failures += 1;
            if inner.failures >= 5 {
                inner.blocked_until = Some(Instant::now() + Duration::from_secs(30));
                inner.failures = 0;
            }
            return Err(ApiError::new(
                "INVALID_PASSWORD",
                "Неверный пароль администратора.",
            ));
        }
        inner.admin_hash = Some(hash);
        inner.failures = 0;
        inner.blocked_until = None;
        self.status(&inner)
    }
    pub fn logout(&self) -> Result<AccessStatus, ApiError> {
        let mut inner = self.lock()?;
        inner.admin_hash = None;
        self.status(&inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, sync::Arc};
    use uuid::Uuid;
    const PASSWORD: &str = "Synthetic-test-password-47";
    fn root() -> PathBuf {
        let p = std::env::temp_dir().join(format!("reestr-access-{}", Uuid::new_v4()));
        fs::create_dir_all(p.join("shared")).unwrap();
        p
    }
    fn client(root: &std::path::Path, name: &str) -> AppState {
        AppState::open(
            root.join("shared"),
            root.join(name),
            root.join("seed.db"),
            true,
        )
        .unwrap()
    }
    #[test]
    fn viewer_cannot_mutate_or_preview_even_before_setup() {
        let p = root();
        let app = client(&p, "a");
        assert_eq!(app.access().unwrap().role, "viewer");
        assert_eq!(
            app.write(|c| {
                c.execute("INSERT INTO THEME VALUES ('bad',1)", [])?;
                Ok(())
            })
            .unwrap_err()
            .code,
            "FORBIDDEN"
        );
        assert_eq!(app.admin_read(|_| Ok(())).unwrap_err().code, "FORBIDDEN");
        assert!(!p.join("shared/current.json").exists());
        drop(app);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn setup_login_logout_and_password_hash() {
        let p = root();
        let a = client(&p, "a");
        let b = client(&p, "b");
        assert!(a.setup_admin("short").is_err());
        a.setup_admin(PASSWORD).unwrap();
        assert_eq!(b.setup_admin(PASSWORD).unwrap_err().code, "ADMIN_EXISTS");
        assert_eq!(b.login("invalid").unwrap_err().code, "INVALID_PASSWORD");
        assert_eq!(b.access().unwrap().role, "viewer");
        b.login(PASSWORD).unwrap();
        let hash = b.read(|c| Ok(password_hash(c)?.unwrap())).unwrap();
        assert!(hash.starts_with("$argon2id$"));
        assert!(!hash.contains(PASSWORD));
        b.logout().unwrap();
        assert_eq!(b.write(|_| Ok(())).unwrap_err().code, "FORBIDDEN");
        drop((a, b));
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn simultaneous_writers_preserve_both_changes_and_readers_refresh() {
        let p = root();
        let a = Arc::new(client(&p, "a"));
        a.setup_admin(PASSWORD).unwrap();
        let b = Arc::new(client(&p, "b"));
        b.login(PASSWORD).unwrap();
        let viewer = client(&p, "viewer");
        let jobs: Vec<_> = [(a.clone(), "A"), (b.clone(), "B")]
            .into_iter()
            .map(|(a, name)| {
                std::thread::spawn(move || {
                    a.write(|c| {
                        c.execute("INSERT INTO THEME(name,user_created) VALUES (?1,1)", [name])?;
                        Ok(())
                    })
                })
            })
            .collect();
        for j in jobs {
            j.join().unwrap().unwrap();
        }
        assert_eq!(
            viewer
                .read(
                    |c| Ok(c.query_row("SELECT COUNT(*) FROM THEME", [], |r| r.get::<_, i64>(0))?)
                )
                .unwrap(),
            2
        );
        assert_eq!(viewer.access().unwrap().role, "viewer");
        drop((a, b, viewer));
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn failed_operation_is_never_published() {
        let p = root();
        let a = client(&p, "a");
        a.setup_admin(PASSWORD).unwrap();
        let before = a.access().unwrap().revision;
        let result: Result<(), ApiError> = a.write(|c| {
            c.execute("INSERT INTO THEME(name,user_created) VALUES('bad',1)", [])?;
            Err(ApiError::validation("reject"))
        });
        assert!(result.is_err());
        assert_eq!(a.access().unwrap().revision, before);
        assert_eq!(
            a.read(|c| Ok(c.query_row("SELECT COUNT(*) FROM THEME", [], |r| r.get::<_, i64>(0))?))
                .unwrap(),
            0
        );
        drop(a);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn disconnect_and_tampering_fail_without_empty_registry() {
        let p = root();
        let a = client(&p, "a");
        a.setup_admin(PASSWORD).unwrap();
        fs::rename(p.join("shared"), p.join("offline")).unwrap();
        assert!(a.access().is_err());
        fs::rename(p.join("offline"), p.join("shared")).unwrap();
        assert!(a.access().unwrap().initialized);
        let h = a.store.head().unwrap().unwrap();
        fs::write(
            p.join("shared/snapshots")
                .join(format!("{}.db", h.revision)),
            b"broken",
        )
        .unwrap();
        assert!(AppState::open(p.join("shared"), p.join("new"), p.join("seed.db"), true).is_err());
        drop(a);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn legacy_schema_four_is_migrated_without_changing_the_seed() {
        let p = root();
        let seed = p.join("seed.db");
        {
            let c = Connection::open(&seed).unwrap();
            for (_, sql) in &crate::db::MIGRATIONS[..4] {
                c.execute_batch(sql).unwrap();
            }
            c.execute_batch("CREATE TABLE schema_version(version INTEGER NOT NULL);INSERT INTO schema_version VALUES(4);INSERT INTO THEME(name,user_created) VALUES('Сохранённая тема',1);").unwrap();
        }
        let before = crate::network::store::hash_file(&seed).unwrap();
        let a = client(&p, "a");
        a.setup_admin(PASSWORD).unwrap();
        let b = client(&p, "b");
        b.read(|c| {
            assert_eq!(
                c.query_row("SELECT version FROM schema_version", [], |r| r
                    .get::<_, i64>(0))?,
                5
            );
            assert_eq!(
                c.query_row("SELECT name FROM THEME", [], |r| r.get::<_, String>(0))?,
                "Сохранённая тема"
            );
            Ok(())
        })
        .unwrap();
        assert_eq!(before, crate::network::store::hash_file(&seed).unwrap());
        drop((a, b));
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn publication_failure_keeps_last_committed_revision_and_data() {
        let p = root();
        let app = client(&p, "a");
        app.setup_admin(PASSWORD).unwrap();
        let before = app.access().unwrap().revision;
        fs::rename(p.join("shared/snapshots"), p.join("saved-snapshots")).unwrap();
        fs::write(p.join("shared/snapshots"), b"unavailable directory").unwrap();
        let result = app.write(|c| {
            c.execute(
                "INSERT INTO THEME(name,user_created) VALUES('not-published',1)",
                [],
            )?;
            Ok(())
        });
        assert!(result.is_err());
        fs::remove_file(p.join("shared/snapshots")).unwrap();
        fs::rename(p.join("saved-snapshots"), p.join("shared/snapshots")).unwrap();
        assert_eq!(app.access().unwrap().revision, before);
        let reader = client(&p, "reader");
        for state in [&app, &reader] {
            assert_eq!(
                state
                    .read(|c| Ok(
                        c.query_row("SELECT COUNT(*) FROM THEME", [], |r| r.get::<_, i64>(0))?
                    ))
                    .unwrap(),
                0
            );
        }
        drop((app, reader));
        fs::remove_dir_all(p).unwrap();
    }
}
