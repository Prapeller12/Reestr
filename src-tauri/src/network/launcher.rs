//! Local runtime bootstrap adapted from production-cycle 26b97e3 (SMB startup fix).
use super::startup;
use super::store::hash_file;
use fs2::FileExt;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    env,
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    enabled: bool,
    version: String,
    exe_sha256: String,
    runtime_sha256: String,
    runtime_folder: String,
}
fn config(path: &Path) -> Result<Config, String> {
    let bytes = fs::read(path).map_err(|e| format!("Не удалось прочитать network.json: {e}"))?;
    let c: Config =
        serde_json::from_slice(&bytes).map_err(|e| format!("Некорректный network.json: {e}"))?;
    for part in [&c.version, &c.runtime_folder] {
        if part.is_empty()
            || part == "."
            || part == ".."
            || !part
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        {
            return Err("Некорректная версия или путь в network.json".into());
        }
    }
    if !c
        .runtime_folder
        .starts_with("Microsoft.WebView2.FixedVersionRuntime.")
        || !c.runtime_folder.ends_with(".x64")
    {
        return Err("Некорректная папка WebView2 в network.json".into());
    }
    Ok(c)
}
pub fn maybe_relaunch() -> Result<bool, String> {
    if env::var_os("REESTR_NETWORK_CLIENT").is_some() {
        let exe = env::current_exe()
            .map_err(|e| e.to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !is_local_disk(&exe) {
            return Err("Клиент и WebView2 должны запускаться с локального диска.".into());
        }
        return Ok(false);
    }
    let exe = env::current_exe().map_err(|e| e.to_string())?;
    let root = exe
        .parent()
        .ok_or("Не найдена папка программы")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !root.join("config/network.json").is_file() {
        return Ok(false);
    }
    let c = config(&root.join("config/network.json"))?;
    if !c.enabled {
        return Ok(false);
    }
    let identity = format!(
        "{:x}",
        Sha256::digest(root.to_string_lossy().to_lowercase().as_bytes())
    );
    let base = local_cache_base()?.join(&identity[..16]);
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(base.join("prepare.lock"))
        .map_err(|e| e.to_string())?;
    let started = Instant::now();
    while lock.try_lock_exclusive().is_err() {
        if started.elapsed() > Duration::from_secs(240) {
            return Err("Другой запуск не завершил подготовку локального клиента.".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
    let cache = base.join(&c.version);
    let valid = |folder: &Path| -> bool {
        hash_file(&folder.join("reestr.exe"))
            .map(|h| h.eq_ignore_ascii_case(&c.exe_sha256))
            .unwrap_or(false)
            && hash_file(&folder.join(&c.runtime_folder).join("msedgewebview2.exe"))
                .map(|h| h.eq_ignore_ascii_case(&c.runtime_sha256))
                .unwrap_or(false)
    };
    if !cache.join(".ready").is_file() || !valid(&cache) {
        startup::update(
            "Получение локального клиента. Первый запуск может занять несколько минут…",
        );
        let staging = base.join(format!(".staging-{}", Uuid::new_v4()));
        fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
        for name in ["reestr.exe", c.runtime_folder.as_str()] {
            if let Err(e) = copy_entry(&root.join(name), &staging.join(name)) {
                let _ = fs::remove_dir_all(&staging);
                return Err(e);
            }
        }
        if !valid(&staging) {
            let _ = fs::remove_dir_all(&staging);
            return Err(
                "Контрольная сумма клиента или WebView2 не совпала. Повторно распакуйте ZIP."
                    .into(),
            );
        }
        fs::write(staging.join(".ready"), &c.version).map_err(|e| e.to_string())?;
        if cache.exists() {
            fs::remove_dir_all(&cache)
                .map_err(|e| format!("Закройте ранее запущенный клиент: {e}"))?;
        }
        fs::rename(&staging, &cache).map_err(|e| e.to_string())?;
    }
    FileExt::unlock(&lock).map_err(|e| e.to_string())?;
    let data = base.join("sessions").join(Uuid::new_v4().to_string());
    fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let mut command = Command::new(cache.join("reestr.exe"));
    command
        .args(env::args().skip(1))
        .arg("--network-client")
        .env("REESTR_NETWORK_CLIENT", "1")
        .env("REESTR_SHARED_ROOT", &root)
        .env("REESTR_CLIENT_DATA", &data)
        .current_dir(&cache);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Не удалось запустить локальный клиент: {e}"))?;
    startup::stop();
    if env::args().any(|a| a == "--smoke-test")
        && !child.wait().map_err(|e| e.to_string())?.success()
    {
        return Err("Проверка клиента завершилась ошибкой.".into());
    }
    Ok(true)
}
fn copy_entry(source: &Path, target: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(source)
        .map_err(|e| format!("Не найден файл комплекта {}: {e}", source.display()))?;
    if meta.file_type().is_symlink() {
        return Err("Ссылки в комплекте программы не поддерживаются.".into());
    }
    if meta.is_dir() {
        fs::create_dir_all(target).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
            let e = entry.map_err(|e| e.to_string())?;
            copy_entry(&e.path(), &target.join(e.file_name()))?;
        }
    } else {
        startup::update(&format!(
            "Получение локальной копии: {}",
            source.file_name().unwrap_or_default().to_string_lossy()
        ));
        fs::copy(source, target).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn local_cache_base() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(path));
    }
    if let Some(path) = env::var_os("USERPROFILE") {
        candidates.push(PathBuf::from(path).join("AppData/Local"));
    }
    candidates.push(env::temp_dir());
    for candidate in candidates {
        if fs::create_dir_all(&candidate).is_err() {
            continue;
        }
        let Ok(real) = candidate.canonicalize() else {
            continue;
        };
        if !is_local_disk(&real) {
            continue;
        }
        let base = real.join("ReestrNetwork/cache");
        if fs::create_dir_all(&base).is_err() {
            continue;
        }
        let probe = base.join(format!(".write-test-{}", Uuid::new_v4()));
        if fs::write(&probe, b"ok").is_ok() {
            let _ = fs::remove_file(probe);
            return Ok(base);
        }
    }
    Err("Нет доступной локальной папки для клиента. Локальный профиль Windows или TEMP должен находиться на диске этого компьютера и разрешать запись. WebView2 нельзя запускать из сетевой папки.".into())
}

#[cfg(windows)]
pub(crate) fn is_local_disk(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetVolumePathNameW};
    let input: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut volume = vec![0u16; 32768];
    unsafe {
        GetVolumePathNameW(input.as_ptr(), volume.as_mut_ptr(), volume.len() as u32) != 0
            && matches!(GetDriveTypeW(volume.as_ptr()), 2 | 3)
    }
}
#[cfg(not(windows))]
pub(crate) fn is_local_disk(_path: &Path) -> bool {
    true
}
