// Реестр писем: SMB snapshots, local WebView2 and administrator-only writes.

// Небольшие внутренние helper'ы (конструкторы ошибок, EXPECTED_HEADERS и т.п.)
// могут не использоваться во всех сборках — не шумим предупреждениями.
#![allow(dead_code)]

mod commands;
mod db;
mod domain;
mod dto;
mod error;
mod import;
mod model;
mod network;
mod repo;
mod smoke;
mod state;
mod util;
mod view;

use std::path::{Path, PathBuf};
use tauri::Manager;

use state::AppState;

/// Папка, где лежит exe. Резолв строго от бинаря (принцип 4), не от CWD.
fn resolve_exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Ищет вшитую папку Fixed WebView2 Runtime рядом с exe вне зависимости от версии.
/// Имя: `Microsoft.WebView2.FixedVersionRuntime.<ver>.x64`.
fn find_fixed_webview2(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
            if name.starts_with("Microsoft.WebView2.FixedVersionRuntime.") && name.ends_with(".x64")
            {
                return Some(path);
            }
        }
    }
    None
}

/// Windows 10 + Fixed Version WebView2 ≥120: рендерер работает в App Container и
/// требует прав чтения/выполнения на папку рантайма для групп ALL APPLICATION
/// PACKAGES / ALL RESTRICTED APPLICATION PACKAGES (док Microsoft «Distribution»).
/// NTFS-ACL не переживают копирование на другой ПК, поэтому выставляем их сами —
/// один раз на каждую машину (маркер по имени ПК), рекурсивно, без прав админа и
/// без единой команды от пользователя. На Windows 11 — безвредный no-op.
#[cfg(target_os = "windows")]
fn ensure_webview2_acl(runtime: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000; // не мигать консолью из GUI-процесса

    // Идентификатор машины — имя ПК. После копирования папки на другой ПК маркер
    // не совпадёт → права переприменятся на новой машине.
    let machine = std::env::var("COMPUTERNAME").unwrap_or_default();
    if machine.is_empty() {
        return Err("Не удалось определить компьютер для настройки WebView2.".into());
    }
    let marker = runtime.join(".reestr-acl");
    if let Ok(saved) = std::fs::read_to_string(&marker) {
        if saved.trim() == machine {
            return Ok(()); // уже применено на этой машине
        }
    }

    // *S-1-15-2-1 = ALL APPLICATION PACKAGES, *S-1-15-2-2 = ALL RESTRICTED
    // APPLICATION PACKAGES. (OI)(CI) — наследование на файлы/подпапки, (RX) —
    // чтение+выполнение. /T — рекурсивно (иначе вложенные файлы прав не получат),
    // /C — не падать на ошибках, /Q — тихо.
    let ok = std::process::Command::new("icacls")
        .arg(runtime.as_os_str())
        .args([
            "/grant",
            "*S-1-15-2-1:(OI)(CI)(RX)",
            "/grant",
            "*S-1-15-2-2:(OI)(CI)(RX)",
            "/T",
            "/C",
            "/Q",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !ok {
        return Err(
            "Не удалось настроить локальные права WebView2. Проверьте разрешения папки профиля."
                .into(),
        );
    }
    std::fs::write(&marker, &machine).map_err(|e| e.to_string())
}

/// На не-Windows целях (линт/кросс-сборка) — пусто.
#[cfg(not(target_os = "windows"))]
fn ensure_webview2_acl(_runtime: &Path) -> Result<(), String> {
    Ok(())
}

/// WebView2 и профиль работают локально; общая папка содержит только опубликованные данные.
fn bootstrap_environment(dir: &Path, data: &Path) -> Result<(), String> {
    // Каждый запуск получает отдельный локальный профиль, включая параллельные сеансы.
    let webview_data = data.join("webview");
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_data);

    // Использовать вшитый Fixed Runtime, если он рядом; иначе (dev-машина) —
    // системный WebView2/Edge. Версия определяется динамически (см. find_fixed_webview2).
    if let Some(runtime) = find_fixed_webview2(dir) {
        std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &runtime);
        // На Win10 (Fixed Version ≥120) без прав App Container рендерер не читает
        // рантайм; выставляем их сами ДО создания webview, один раз на машину.
        ensure_webview2_acl(&runtime)?;
    } else if !cfg!(debug_assertions) {
        return Err("В комплекте не найден встроенный WebView2. Полностью распакуйте ZIP.".into());
    }

    // Локальные временные снимки и профиль создаются до запуска WebView2.
    std::fs::create_dir_all(data).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    network::startup::start();
    match network::launcher::maybe_relaunch() {
        Ok(true) => return,
        Ok(false) => {}
        Err(e) => startup_failure(&e),
    }
    let exe_dir = resolve_exe_dir();
    let network_root = std::env::var_os("REESTR_SHARED_ROOT").map(PathBuf::from);
    let data = std::env::var_os("REESTR_CLIENT_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| exe_dir.join("data"));
    if let Err(e) = bootstrap_environment(&exe_dir, &data) {
        startup_failure(&e)
    }
    let network = network_root.is_some();
    let root = network_root
        .as_ref()
        .map(|p| p.join("shared"))
        .unwrap_or_else(|| data.join("shared"));
    if !network {
        if let Err(e) = std::fs::create_dir_all(&root) {
            startup_failure(&e.to_string())
        }
    }
    let seed = network_root
        .map(|p| p.join("shared/initial/registry.db"))
        .unwrap_or_else(|| exe_dir.join("data/registry.db"));
    network::startup::update("Подключение к общей папке и проверка базы…");
    let app_state = AppState::open(root, data.clone(), seed, network)
        .unwrap_or_else(|e| startup_failure(&e.to_string()));
    let smoke = std::env::args().any(|a| a == "--smoke-test");
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .manage(smoke::Smoke(smoke))
        .invoke_handler(tauri::generate_handler![
            commands::frontend_ready,
            smoke::finish_smoke,
            commands::get_access,
            commands::setup_admin,
            commands::login_admin,
            commands::logout_admin,
            commands::get_registry,
            commands::get_document,
            commands::import_preview,
            commands::import_apply,
            commands::list_import_batches,
            commands::search_letters,
            commands::attach_letter,
            commands::detach_letter,
            commands::set_deadline,
            commands::clear_deadline,
            commands::set_field_override,
            commands::clear_field_override,
            commands::get_field_suggestions,
            commands::assign_theme,
            commands::bulk_assign_themes,
            commands::bulk_clear_themes,
            commands::create_theme,
            commands::delete_theme,
            commands::list_themes,
            commands::get_timeline,
            commands::get_compare,
            commands::get_print_model,
        ])
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
            }
            Ok(())
        })
        .on_page_load(move |window, payload| {
            if smoke && payload.event() == tauri::webview::PageLoadEvent::Finished {
                let _ = window.eval(&smoke::script());
            }
        })
        .run(tauri::generate_context!());
    network::startup::stop();
    if let Err(e) = result {
        startup_failure(&e.to_string())
    }
    if network {
        let _ = std::fs::remove_dir_all(&data);
    }
}

pub(crate) fn startup_failure(message: &str) -> ! {
    network::startup::stop();
    smoke::startup_error(message);
    network::startup::show_error(message);
    std::process::exit(1)
}
