// Managed state Tauri. Для однопользовательского локального файла достаточно
// Mutex<Connection> (backend.md §main). exe_dir храним для путей к ./data, ./imports.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub exe_dir: PathBuf,
}
