# Реестр писем

Сетевая portable-версия для учёта входящей и исходящей корреспонденции.
Один комплект в общей SMB-папке; пользователи запускают `reestr.exe` на своих ПК.
Просмотр доступен без входа, импорт и все изменения — только администратору.
Встроенный WebView2 и клиент автоматически копируются на локальный диск.
Интернет, отдельная СУБД и установка среды разработки на рабочих местах не нужны.

**Развёртывание, права Windows, перенос старой базы и резервное копирование:**
[scripts/release-assets/README-NETWORK.txt](scripts/release-assets/README-NETWORK.txt).
Эта инструкция заменяет прежние правила размещения `data/registry.db` для сетевой сборки.

## Стек и хранение

- Tauri 2 / Rust, React 18 / TypeScript; SQLite встроен в EXE.
- `shared/current.json` указывает на неизменяемый снимок `shared/snapshots/<revision>.db`.
  SQLite открывается только на локальном диске/в памяти. Публикация сериализована
  блокировкой SMB, проверена по SHA-256 и целостности SQLite; указатель заменяется атомарно.
- Пароль администратора хранится как Argon2id-хеш, роль проверяется в каждой изменяющей
  backend-команде. Права Windows/SMB обязательны для защиты файлов от прямого изменения.
- Переимпорт сохраняет связи, темы, сроки и пользовательские правки.
- Независимые цепочки в стопке Ганта раскрываются в отдельные строки.

Решение переносит проверенный механизм локального запуска из
[production-cycle 26b97e3](https://github.com/Prapeller12/production-cycle/commit/26b97e377fe9618cf59958ad5f501a838cfc8676).
Ограничение трёх клиентов того приложения сюда не переносится: в реестре используется
модель «администратор пишет — пользователи читают», читателям запись в shared не нужна.

## Проверки сетевой версии

`npm test`, `npm run build`, `cargo test --locked --release` и статические проверки.
Workflow `windows-portable.yml` проверяет готовый ZIP на Windows Server 2022/2025:
реальный SMB по IP, повторный запуск, сетевой диск, перенаправленный профиль,
общий ресурс только для чтения, видимое окно и ошибки запуска, native WebView/IPC,
вход администратора, импорт и раскрытие трёх цепочек. Целевые клиентские ОС —
Windows 10/11 x64; их отдельная функциональная приёмка остаётся необходимой.

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
