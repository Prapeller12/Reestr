// Ядро приложения «Реестр писем» (Tauri v2).
// Порядок старта (backend.md §3, §4):
//   1) папка программы = current_exe().parent() (НИКОГДА current_dir);
//   2) env WebView2 выставляем ДО постройки webview (профиль в ./data/webview,
//      вшитый Fixed Runtime вместо системного Edge);
//   3) создаём ./data и ./imports;
//   4) открываем/мигрируем ./data/registry.db;
//   5) регистрируем 22 команды и поднимаем окно (18 базовых + правка полей/справочник, батч 2
//      + удаление темы, QA-3 F4).

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
mod repo;
mod state;
mod util;
mod view;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

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
fn ensure_webview2_acl(runtime: &Path) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000; // не мигать консолью из GUI-процесса

    // Идентификатор машины — имя ПК. После копирования папки на другой ПК маркер
    // не совпадёт → права переприменятся на новой машине.
    let machine = std::env::var("COMPUTERNAME").unwrap_or_default();
    if machine.is_empty() {
        return;
    }
    let marker = runtime.join(".reestr-acl");
    if let Ok(saved) = std::fs::read_to_string(&marker) {
        if saved.trim() == machine {
            return; // уже применено на этой машине
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

    if ok {
        let _ = std::fs::write(&marker, &machine);
    }
}

/// На не-Windows целях (линт/кросс-сборка) — пусто.
#[cfg(not(target_os = "windows"))]
fn ensure_webview2_acl(_runtime: &Path) {}

/// Выставляет env WebView2 и создаёт рабочие подпапки. Всё внутри папки программы (принцип 3).
fn bootstrap_environment(dir: &Path) {
    // Профиль WebView2 — в папку программы, иначе он «наследит» в %LOCALAPPDATA% (§4).
    let webview_data = dir.join("data").join("webview");
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_data);

    // Использовать вшитый Fixed Runtime, если он рядом; иначе (dev-машина) —
    // системный WebView2/Edge. Версия определяется динамически (см. find_fixed_webview2).
    if let Some(runtime) = find_fixed_webview2(dir) {
        std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &runtime);
        // На Win10 (Fixed Version ≥120) без прав App Container рендерер не читает
        // рантайм; выставляем их сами ДО создания webview, один раз на машину.
        ensure_webview2_acl(&runtime);
    }

    // Идемпотентно создаём ./data (для БД) и ./imports (куда кладут выгрузки).
    // ./data/webview создаст сам WebView2; ./logs — лениво при включении логов (§11).
    let _ = std::fs::create_dir_all(dir.join("data"));
    let _ = std::fs::create_dir_all(dir.join("imports"));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let exe_dir = resolve_exe_dir();
    bootstrap_environment(&exe_dir);

    let db_path = exe_dir.join("data").join("registry.db");
    let connection = db::open_and_migrate(&db_path)
        .unwrap_or_else(|e| {
            panic!(
                "Не удалось открыть базу данных {}. Проверьте, что папка программы доступна для записи. Подробности: {e}",
                db_path.display()
            )
        });

    let app_state = AppState {
        db: Mutex::new(connection),
        exe_dir,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
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
        .run(tauri::generate_context!())
        .expect("Не удалось запустить программу.");
}
