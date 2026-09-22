// Тонкая точка входа: в release прячем консольное окно, делегируем в reestr_lib::run().
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    reestr_lib::run();
}
