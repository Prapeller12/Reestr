//! Explicit opt-in packaged application acceptance test; unavailable in normal sessions.
use serde_json::{json, Value};
use tauri::{Manager, State};
pub struct Smoke(pub bool);
pub fn script() -> String {
    let config = json!({"phase":std::env::var("REESTR_SMOKE_PHASE").unwrap_or_default(),"outgoing":std::env::var("REESTR_SMOKE_OUT").unwrap_or_default(),"incoming":std::env::var("REESTR_SMOKE_IN").unwrap_or_default()});
    format!(
        "window.REESTR_SMOKE={config};\n{}",
        include_str!("../../scripts/network-native-smoke.js")
    )
}
#[tauri::command]
pub fn finish_smoke(
    app: tauri::AppHandle,
    enabled: State<'_, Smoke>,
    mut report: Value,
) -> Result<(), String> {
    if !enabled.0 {
        return Err("Self-test is not enabled".into());
    }
    let window = app
        .get_webview_window("main")
        .ok_or("Main window missing")?;
    report["windowVisible"] = json!(window.is_visible().unwrap_or(false));
    report["frontendReady"] = json!(crate::network::startup::is_ready());
    report["exe"] = json!(std::env::current_exe().ok());
    report["runtime"] =
        json!(std::env::var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER").unwrap_or_default());
    report["profile"] = json!(std::env::var("WEBVIEW2_USER_DATA_FOLDER").unwrap_or_default());
    let path = std::env::var("REESTR_SMOKE_REPORT").map_err(|e| e.to_string())?;
    std::fs::write(
        path,
        serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    app.exit(if report["ok"] == true { 0 } else { 1 });
    Ok(())
}
pub fn startup_error(message: &str) {
    if std::env::args().any(|a| a == "--smoke-test") {
        if let Ok(path) = std::env::var("REESTR_SMOKE_REPORT") {
            if !std::path::Path::new(&path).exists() {
                let _ = std::fs::write(path, json!({"ok":false,"error":message}).to_string());
            }
        }
    }
}
