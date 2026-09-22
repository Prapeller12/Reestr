# Реестр писем

Офлайн portable-приложение для учёта входящей и исходящей корреспонденции: импорт выгрузки
1С (`.txt`), связывание писем в цепочки, темы, сроки и статусы, таймлайн, печать в PDF.
Работает без установки и без интернета, данные лежат рядом с exe.

**Принципы:** офлайн · автономный запуск · локальное хранение данных · БД в папке программы ·
exe без установки.

## Стек

- **Ядро:** Tauri 2 (Rust), SQLite через `rusqlite` (feature `bundled` — движок вкомпилирован
  в бинарь, внешний DLL не нужен).
- **UI:** React 18 + Vite + TypeScript, статическая SPA, встраивается в exe.
- **БД:** один файл `./data/registry.db` рядом с exe (WAL). Факты из 1С и пользовательский
  оверлей (связи/темы/сроки) разделены — переимпорт оверлей не стирает.

## Структура

```
reestr/
├── index.html            Vite-entry (единственный HTML)
├── package.json · vite.config.ts · vitest.config.ts · tsconfig*.json
├── src/                  React SPA (TypeScript, БЭМ-стили)
│   ├── api/              обёртки над Tauri-командами + типы (зеркало Rust DTO)
│   ├── components/       компоненты
│   ├── blocks/           CSS по БЭМ, собирается в src/index.css
│   ├── hooks/ lib/       хуки и чистая логика (+ юнит-тесты *.test.ts)
│   └── vendor/ images/   шрифты, normalize.css, растр
├── src-tauri/            Rust-ядро
│   ├── src/              команды, репозитории, парсер импорта, доменная логика
│   ├── migrations/       схема SQLite
│   ├── icons/            иконки приложения
│   └── tauri.conf.json · Cargo.toml
├── scripts/              сборка релиза и проверки (PowerShell, Node)
└── logo/                 исходники логотипа и генератор набора (build.py)
```

## Предпосылки сборки

1. **Node.js 18+** и npm.
2. **Rust, toolchain MSVC** — `x86_64-pc-windows-msvc`. GNU не используем: он тянет отдельный
   `WebView2Loader.dll`, то есть лишний файл рядом с exe.
   Установка: [rustup.rs](https://rustup.rs), затем
   `rustup default stable-x86_64-pc-windows-msvc`.
3. **WebView2** — для dev достаточно рантайма, который уже есть в Windows 10/11.
   Для портативной раздачи нужен **Fixed Version** дистрибутив (x64) с сайта Microsoft:
   папка `Microsoft.WebView2.FixedVersionRuntime.<ver>.x64` кладётся рядом с exe.

## Сборка и запуск

```powershell
npm install                        # зависимости фронта
npm run tauri dev                  # dev: Vite на :1420 + окно Tauri (hot-reload)
npm run tauri build -- --no-bundle # релиз: один reestr.exe со встроенной SPA
```

Готовый бинарь — `src-tauri/target/release/reestr.exe`.

Быстрые проверки без Tauri:

```powershell
npm run build      # tsc --noEmit + vite build
npm test           # vitest: юнит-тесты фронтовой логики
cd src-tauri; cargo test    # тесты ядра
```

## Портативная раздача

Папку для раздачи собирает `scripts/package-release.ps1`:

```
Реестр/
├── reestr.exe                                          ядро + встроенная SPA
├── Microsoft.WebView2.FixedVersionRuntime.<ver>.x64/   вшитый рантайм (~130–180 МБ)
├── data/registry.db                                    пустая схема
├── imports/                                            сюда кладут выгрузки .txt
└── README.txt                                          как запускать
```

Удаление программы — удаление её папки после закрытия и резервного копирования.
Отсутствие системных следов запуска Windows не гарантируется.

## Замечание про тесты парсера

Тесты `src-tauri/src/import/parser.rs`, работающие на реальных выгрузках 1С, закрыты
cargo-фичей `real-fixtures`: сами выгрузки содержат данные организации и в репозиторий не
выкладываются. По умолчанию `cargo test` проходит на синтетических случаях; с фикстурами
в `src-tauri/tests/fixtures/` запуск такой:

```powershell
cargo test --features real-fixtures
```
