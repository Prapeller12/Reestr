//! Shared immutable SQLite snapshots. Only the administrator publishes; readers need no write access.
use crate::{db, error::ApiError};
use fs2::FileExt;
use rusqlite::{backup::Backup, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Head {
    pub revision: String,
    pub sha256: String,
}

pub struct Store {
    pub root: PathBuf,
    pub local: PathBuf,
    pub seed: PathBuf,
}
impl Store {
    pub fn head(&self) -> Result<Option<Head>, ApiError> {
        let path = self.root.join("current.json");
        match fs::read(&path) {
            Ok(bytes) => {
                let head: Head = serde_json::from_slice(&bytes).map_err(|_| {
                    ApiError::io(
                        "Повреждён указатель общей базы current.json. Обратитесь к администратору.",
                    )
                })?;
                if Uuid::parse_str(&head.revision).is_err()
                    || head.sha256.len() != 64
                    || !head.sha256.bytes().all(|b| b.is_ascii_hexdigit())
                {
                    return Err(ApiError::io("Некорректный указатель общей базы."));
                }
                Ok(Some(head))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // Missing share is not an empty new registry; never silently recreate it.
                if !self.root.is_dir() {
                    return Err(ApiError::io(
                        "Общая папка недоступна. Проверьте подключение к серверу.",
                    ));
                }
                if self.root.join("snapshots").is_dir()
                    && fs::read_dir(self.root.join("snapshots"))?.any(|e| {
                        e.map(|e| e.path().extension().is_some_and(|s| s == "db"))
                            .unwrap_or(false)
                    })
                {
                    return Err(ApiError::io("В общей папке есть снимки, но нет current.json. Требуется восстановление администратором."));
                }
                Ok(None)
            }
            Err(e) => Err(e.into()),
        }
    }
    pub fn lock_writer(&self) -> Result<File, ApiError> {
        let file = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(self.root.join("writer.lock"))
            .map_err(|_| ApiError::new("FORBIDDEN", "Нет права записи в общую папку. Импорт и изменения доступны администратору с разрешением Windows на изменение этой папки."))?;
        let start = Instant::now();
        loop {
            match file.try_lock_exclusive() {
                Ok(()) => return Ok(file),
                Err(_) if start.elapsed() < Duration::from_secs(15) => {
                    thread::sleep(Duration::from_millis(75))
                }
                Err(_) => {
                    return Err(ApiError::new(
                        "STORE_BUSY",
                        "Другой администратор сохраняет изменения. Повторите действие.",
                    ))
                }
            }
        }
    }
    pub fn load(&self, head: Option<&Head>) -> Result<Connection, ApiError> {
        let source = head
            .map(|h| {
                self.root
                    .join("snapshots")
                    .join(format!("{}.db", h.revision))
            })
            .unwrap_or_else(|| self.seed.clone());
        let mut memory = Connection::open_in_memory()?;
        let exists = match source.metadata() {
            Ok(metadata) if metadata.is_file() => true,
            Ok(_) => {
                return Err(ApiError::io(
                    "Ожидался файл базы данных, но найден каталог.",
                ))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
            Err(e) => return Err(e.into()),
        };
        if exists {
            if head.is_none()
                && source
                    .with_file_name(format!(
                        "{}-wal",
                        source.file_name().unwrap().to_string_lossy()
                    ))
                    .metadata()
                    .map(|m| m.len() > 0)
                    .unwrap_or(false)
            {
                return Err(ApiError::io("Закройте старую программу перед переносом базы: рядом с registry.db обнаружен незавершённый WAL."));
            }
            let local = self.local.join(format!("incoming-{}.db", Uuid::new_v4()));
            fs::copy(&source, &local)?;
            let result = (|| {
                if let Some(head) = head {
                    if hash_file(&local)? != head.sha256 {
                        return Err(ApiError::io(
                            "Контрольная сумма общей базы не совпала. Данные не загружены.",
                        ));
                    }
                }
                let incoming =
                    Connection::open_with_flags(&local, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
                validate(&incoming)?;
                copy_connection(&incoming, &mut memory)?;
                Ok(())
            })();
            let _ = fs::remove_file(local);
            result?;
        } else if head.is_some() {
            return Err(ApiError::io("Не найден опубликованный снимок общей базы."));
        }
        db::run_migrations(&mut memory)?;
        memory.execute_batch("PRAGMA foreign_keys=ON;")?;
        validate(&memory)?;
        Ok(memory)
    }
    pub fn publish(&self, conn: &Connection) -> Result<Head, ApiError> {
        validate(conn)?;
        let head_id = Uuid::new_v4().to_string();
        let local = self.local.join(format!("outgoing-{head_id}.db"));
        {
            let mut dest = Connection::open(&local)?;
            copy_connection(conn, &mut dest)?;
            validate(&dest)?;
        }
        let result = (|| {
            let snapshots = self.root.join("snapshots");
            fs::create_dir_all(&snapshots)?;
            let target = snapshots.join(format!("{head_id}.db"));
            let pending = snapshots.join(format!("{head_id}.pending"));
            fs::copy(&local, &pending)?;
            OpenOptions::new()
                .read(true)
                .write(true)
                .open(&pending)?
                .sync_all()?;
            let hash = hash_file(&local)?;
            if hash_file(&pending)? != hash {
                return Err(ApiError::io(
                    "Не удалось проверить передачу базы на сервер. Изменения не опубликованы.",
                ));
            }
            fs::rename(&pending, &target)?;
            let head = Head {
                revision: head_id,
                sha256: hash,
            };
            // Commit point: atomic pointer replacement after durable, validated snapshot.
            atomic_write(
                &self.root.join("current.json"),
                &serde_json::to_vec(&head).map_err(|e| ApiError::io(e.to_string()))?,
            )?;
            Ok(head)
        })();
        let _ = fs::remove_file(local);
        result
    }
}

pub fn copy_connection(source: &Connection, target: &mut Connection) -> Result<(), ApiError> {
    Backup::new(source, target)?.run_to_completion(256, Duration::from_millis(5), None)?;
    Ok(())
}
pub fn validate(conn: &Connection) -> Result<(), ApiError> {
    let check: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if check != "ok" {
        return Err(ApiError::db("Нарушена целостность базы данных."));
    }
    if conn
        .prepare("PRAGMA foreign_key_check")?
        .query([])?
        .next()?
        .is_some()
    {
        return Err(ApiError::db("Нарушена целостность связей базы данных."));
    }
    Ok(())
}
pub fn hash_file(path: &Path) -> Result<String, ApiError> {
    use std::io::Read;
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut block = [0u8; 65536];
    loop {
        let n = file.read(&mut block)?;
        if n == 0 {
            break;
        }
        hash.update(&block[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), ApiError> {
    let pending = path.with_extension(format!("pending-{}", Uuid::new_v4()));
    let result = (|| {
        let mut file = File::create(&pending)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        atomic_replace(&pending, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(pending);
    }
    result
}
#[cfg(windows)]
fn atomic_replace(from: &Path, to: &Path) -> Result<(), ApiError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let a: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let b: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe {
        MoveFileExW(
            a.as_ptr(),
            b.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}
#[cfg(not(windows))]
fn atomic_replace(from: &Path, to: &Path) -> Result<(), ApiError> {
    fs::rename(from, to)?;
    Ok(())
}
