<#
    package-release.ps1 — упаковка DEV → PUBLIC («Реестр писем»).

    Собирает переносимую папку `Реестр/` строго по форме КОНЦЕПЦИЯ §9 и
    qa-publish.md §1/§10 (INCLUDE/EXCLUDE). Итог — RC-папка, которая после зелёного
    гейта (verify-static.ps1 + ручной tests/QA-CHECKLIST.md разд. B) промоутится в PUBLIC
    БЕЗ пересборки (та же папка — переименование/копия).

    Алгоритм (qa-publish.md §10):
      1. npm run tauri build --no-bundle  (toolchain MSVC) -> src-tauri/target/release/reestr.exe
      2. создать чистую целевую папку
      3. скопировать reestr.exe в корень
      4. скопировать Microsoft.WebView2.FixedVersionRuntime.<ver>.x64/ рядом с exe
      5. создать data/ (пусто), imports/ (+ образец 12.txt), logs/ (пусто), README.txt
      6. проверить INCLUDE полон и EXCLUDE отсутствует (fail-fast)

    ПОЧЕМУ НЕ КЛАДЁМ ГОТОВУЮ registry.db. exe сам создаёт и мигрирует ./data/registry.db
    при первом запуске (backend.md §3; lib.rs -> db::open_and_migrate). Headless-прогон exe
    здесь недоступен (нет запуска), а копировать «руками собранную» БД нельзя — единственный
    источник схемы — миграции в бинаре. Поэтому кладём ПУСТУЮ папку data/, а registry.db
    рождается при первом старте внутри папки (это ожидаемо, qa-publish.md §1/§9).
    Ключ -SeedDb можно задать, если готовая seed-БД уже существует и её надо вложить.

    Rust/cargo на этой машине может отсутствовать — тогда собирайте exe там, где есть
    toolchain, и запускайте скрипт с -SkipBuild -ExePath <путь к reestr.exe>.

    Примеры:
      # обычная упаковка (сборка + копирование рантайма из папки рядом)
      powershell -File scripts\package-release.ps1 -WebView2Path C:\wv2\Microsoft.WebView2.FixedVersionRuntime.131.0.2903.86.x64

      # без сборки (exe уже собран), с предпросмотром действий
      powershell -File scripts\package-release.ps1 -SkipBuild -WebView2Path C:\wv2 -WhatIf
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    # Корень репозитория (родитель scripts\). Пусто → вычисляется ниже.
    [string]$RepoRoot,

    # Куда собрать RC/PUBLIC-папку. Пусто → «Реестр» рядом с репозиторием (вычисляется ниже).
    [string]$OutDir,

    # Путь к папке Fixed WebView2 Runtime ЛИБО к каталогу, внутри которого она лежит.
    # Ищется Microsoft.WebView2.FixedVersionRuntime.*.x64. Обязателен (принцип 2, ~130-180 МБ).
    [string]$WebView2Path,

    # Путь к готовому reestr.exe (если сборку делаем не здесь).
    [string]$ExePath,

    # Пропустить npm-сборку (использовать уже готовый exe).
    [switch]$SkipBuild,

    # Не класть образец 12.txt в imports/.
    [switch]$NoSampleImport,

    # Опционально: путь к уже существующей seed-registry.db, которую вложить в data/.
    [string]$SeedDb,

    # Перезаписать непустую целевую папку.
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# Каталог скрипта. $PSScriptRoot в param-default ненадёжен — резолвим в теле.
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $RepoRoot)  { $RepoRoot  = Split-Path -Parent $ScriptDir }
if (-not $OutDir)    { $OutDir    = Join-Path (Split-Path -Parent $RepoRoot) 'Реестр' }

function Info  { param([string]$m) Write-Host ('  {0}' -f $m) -ForegroundColor DarkGray }
function Step  { param([string]$m) Write-Host ('==> {0}' -f $m) -ForegroundColor Cyan }
function Ok    { param([string]$m) Write-Host ('  [OK]   {0}' -f $m) -ForegroundColor Green }
function Fail  { param([string]$m) Write-Host ('  [FAIL] {0}' -f $m) -ForegroundColor Red; throw $m }

# --- Пути в репозитории ---------------------------------------------------
$DefaultExe   = Join-Path $RepoRoot 'src-tauri\target\release\reestr.exe'
$TauriConf    = Join-Path $RepoRoot 'src-tauri\tauri.conf.json'
$SampleTxt    = Join-Path $RepoRoot '12.txt'
$ReadmeSrc    = Join-Path $ScriptDir 'release-assets\README.txt'

Write-Host ''
Write-Host '=== package-release.ps1 — DEV → PUBLIC («Реестр писем») ===' -ForegroundColor Cyan
Info ('Репозиторий: {0}' -f $RepoRoot)
Info ('Цель (OutDir): {0}' -f $OutDir)
if ($WhatIfPreference) { Write-Host '  (режим -WhatIf: только показ действий, без изменений)' -ForegroundColor Yellow }
Write-Host ''

# ==========================================================================
# ПРЕДПОСЫЛКИ
# ==========================================================================
Step 'Проверка предпосылок'

# README-шаблон.
if (-not (Test-Path $ReadmeSrc)) { Fail ('Не найден шаблон README: {0}' -f $ReadmeSrc) }
Ok ('README-шаблон найден: {0}' -f $ReadmeSrc)

# Fixed WebView2 Runtime: принять либо саму папку, либо каталог с ней внутри.
if (-not $WebView2Path) {
    Fail ('Не задан -WebView2Path. Скачайте «Fixed Version» WebView2 (x64) с сайта Microsoft, ' +
          'распакуйте папку Microsoft.WebView2.FixedVersionRuntime.<ver>.x64 и укажите путь к ней.')
}
if (-not (Test-Path $WebView2Path)) { Fail ('Путь WebView2 не существует: {0}' -f $WebView2Path) }

$wvItem = Get-Item $WebView2Path
$RuntimeDir = $null
if ($wvItem.PSIsContainer -and $wvItem.Name -like 'Microsoft.WebView2.FixedVersionRuntime.*.x64') {
    $RuntimeDir = $wvItem
} else {
    $RuntimeDir = Get-ChildItem -Path $WebView2Path -Directory -Filter 'Microsoft.WebView2.FixedVersionRuntime.*.x64' -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $RuntimeDir) {
    Fail ('В «{0}» не найдена папка Microsoft.WebView2.FixedVersionRuntime.*.x64. ' +
          'Проверьте, что распаковали Fixed Version дистрибутив WebView2 (x64).' -f $WebView2Path)
}
# Санити: внутри рантайма должен быть msedgewebview2.exe.
if (-not (Get-ChildItem -Path $RuntimeDir.FullName -Filter 'msedgewebview2.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    Write-Host ('  [WARN] В {0} не найден msedgewebview2.exe — проверьте целостность рантайма.' -f $RuntimeDir.Name) -ForegroundColor Yellow
}
Ok ('Fixed WebView2 Runtime: {0}' -f $RuntimeDir.Name)

# Сверка версии рантайма с tauri.conf.json (webviewInstallMode.path). Не блокер — WARN.
if (Test-Path $TauriConf) {
    $confRaw = Get-Content -Path $TauriConf -Raw
    if ($confRaw -match '131\.0\.2903\.86') {
        Write-Host '  [WARN] tauri.conf.json всё ещё содержит плейсхолдер-версию 131.0.2903.86 — замените на реальную перед PUBLIC.' -ForegroundColor Yellow
    }
    $m = [regex]::Match($confRaw, 'Microsoft\.WebView2\.FixedVersionRuntime\.([0-9.]+)\.x64')
    if ($m.Success) {
        $confVer = $m.Groups[1].Value
        if ($RuntimeDir.Name -notlike ('*{0}*' -f $confVer)) {
            Write-Host ('  [WARN] Версия рантайма ({0}) не совпадает с tauri.conf.json ({1}). ' -f $RuntimeDir.Name, $confVer) -ForegroundColor Yellow
            Info 'Имя папки рантайма и webviewInstallMode.path должны совпадать (backend.md §4).'
        } else {
            Ok ('Версия рантайма совпадает с tauri.conf.json: {0}' -f $confVer)
        }
    }
}

# ==========================================================================
# СБОРКА
# ==========================================================================
$exe = if ($ExePath) { $ExePath } else { $DefaultExe }

if (-not $SkipBuild) {
    Step 'Сборка бинаря: npm run tauri build --no-bundle (MSVC)'
    if ($PSCmdlet.ShouldProcess($RepoRoot, 'npm run tauri build --no-bundle')) {
        Push-Location $RepoRoot
        try {
            # `--` отделяет аргументы для tauri от npm; собирается один reestr.exe со встроенной SPA.
            & npm run tauri -- build --no-bundle
            if ($LASTEXITCODE -ne 0) { Fail ('npm run tauri build завершился с кодом {0}' -f $LASTEXITCODE) }
        } finally {
            Pop-Location
        }
        Ok 'Сборка завершена'
    }
} else {
    Info 'Сборка пропущена (-SkipBuild)'
}

# Проверка наличия exe (после сборки или переданного явно).
if (-not (Test-Path $exe)) {
    Fail ('Не найден reestr.exe: {0}. Соберите его (уберите -SkipBuild) или укажите -ExePath.' -f $exe)
}
Ok ('exe найден: {0}' -f $exe)

# ==========================================================================
# ЦЕЛЕВАЯ ПАПКА
# ==========================================================================
Step ('Подготовка целевой папки: {0}' -f $OutDir)
if (Test-Path $OutDir) {
    $existing = @(Get-ChildItem -Path $OutDir -Force -ErrorAction SilentlyContinue)
    if ($existing.Count -gt 0 -and -not $Force) {
        Fail ('Папка не пуста: {0}. Добавьте -Force для перезаписи.' -f $OutDir)
    }
    if ($existing.Count -gt 0 -and $Force) {
        if ($PSCmdlet.ShouldProcess($OutDir, 'Очистить папку')) {
            Remove-Item -Path (Join-Path $OutDir '*') -Recurse -Force -ErrorAction SilentlyContinue
            Ok 'Папка очищена'
        }
    }
} else {
    if ($PSCmdlet.ShouldProcess($OutDir, 'Создать папку')) {
        New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
        Ok 'Папка создана'
    }
}

# Хелпер безопасного создания подпапки.
function New-Sub {
    param([string]$Name)
    $p = Join-Path $OutDir $Name
    if ($PSCmdlet.ShouldProcess($p, 'Создать подпапку')) {
        New-Item -ItemType Directory -Path $p -Force | Out-Null
    }
    return $p
}

# ==========================================================================
# КОПИРОВАНИЕ INCLUDE
# ==========================================================================
Step 'Копирование содержимого (INCLUDE, qa-publish.md §10)'

# 1) reestr.exe -> корень
if ($PSCmdlet.ShouldProcess((Join-Path $OutDir 'reestr.exe'), 'Копировать exe')) {
    Copy-Item -Path $exe -Destination (Join-Path $OutDir 'reestr.exe') -Force
    Ok 'reestr.exe -> корень'
}

# 2) Fixed WebView2 Runtime -> рядом с exe (с сохранением имени папки)
$rtDest = Join-Path $OutDir $RuntimeDir.Name
if ($PSCmdlet.ShouldProcess($rtDest, 'Копировать Fixed WebView2 Runtime')) {
    Copy-Item -Path $RuntimeDir.FullName -Destination $rtDest -Recurse -Force
    Ok ('{0} -> рядом с exe' -f $RuntimeDir.Name)
}

# 3) data/ (пусто) — registry.db создастся при первом запуске (см. шапку)
$dataDir = New-Sub 'data'
if ($SeedDb) {
    if (-not (Test-Path $SeedDb)) { Fail ('Указан -SeedDb, но файл не найден: {0}' -f $SeedDb) }
    if ($PSCmdlet.ShouldProcess((Join-Path $dataDir 'registry.db'), 'Вложить seed registry.db')) {
        Copy-Item -Path $SeedDb -Destination (Join-Path $dataDir 'registry.db') -Force
        Ok 'seed registry.db -> data/'
    }
} else {
    Info 'data/ создан пустым — registry.db + миграции появятся при первом запуске exe (backend.md §3)'
}

# 4) imports/ (+ образец 12.txt)
$importsDir = New-Sub 'imports'
if (-not $NoSampleImport) {
    if (Test-Path $SampleTxt) {
        if ($PSCmdlet.ShouldProcess((Join-Path $importsDir '12.txt'), 'Копировать образец 12.txt')) {
            Copy-Item -Path $SampleTxt -Destination (Join-Path $importsDir '12.txt') -Force
            Ok 'образец 12.txt -> imports/'
        }
    } else {
        Write-Host ('  [WARN] Образец 12.txt не найден: {0}' -f $SampleTxt) -ForegroundColor Yellow
    }
}

# 5) logs/ (пусто, опционально — логи по умолчанию выключены, backend.md §11)
New-Sub 'logs' | Out-Null
Info 'logs/ создан пустым (логи по умолчанию выключены)'

# 6) README.txt -> корень
if ($PSCmdlet.ShouldProcess((Join-Path $OutDir 'README.txt'), 'Копировать README.txt')) {
    Copy-Item -Path $ReadmeSrc -Destination (Join-Path $OutDir 'README.txt') -Force
    Ok 'README.txt -> корень'
}

# ==========================================================================
# ПОСТ-ПРОВЕРКА (fail-fast): INCLUDE полон, EXCLUDE отсутствует
# ==========================================================================
if (-not $WhatIfPreference) {
    Step 'Пост-проверка формы папки (qa-publish.md §10)'

    # INCLUDE — обязательные элементы
    $mustExist = @(
        (Join-Path $OutDir 'reestr.exe'),
        $rtDest,
        (Join-Path $OutDir 'data'),
        (Join-Path $OutDir 'imports'),
        (Join-Path $OutDir 'README.txt')
    )
    foreach ($p in $mustExist) {
        if (-not (Test-Path $p)) { Fail ('INCLUDE нарушен — отсутствует: {0}' -f $p) }
    }
    Ok 'INCLUDE: exe, Fixed Runtime, data/, imports/, README.txt — на месте'

    # EXCLUDE — ничего лишнего быть не должно
    $forbidden = @('node_modules', 'src', 'src-tauri', 'target', 'dist', '.git', 'docs', 'КОНЦЕПЦИЯ.md',
                   'КОНЦЕПЦИЯ.html', 'tools', '.claude', 'concept.bat')
    $leaked = @()
    foreach ($name in $forbidden) {
        if (Test-Path (Join-Path $OutDir $name)) { $leaked += $name }
    }
    # Любые .md тоже не должны попадать (README — .txt).
    $mdLeak = @(Get-ChildItem -Path $OutDir -Filter '*.md' -Recurse -File -ErrorAction SilentlyContinue)
    if ($mdLeak.Count -gt 0) { $leaked += ($mdLeak | ForEach-Object { $_.Name }) }

    if ($leaked.Count -gt 0) {
        Fail ('EXCLUDE нарушен — в папке есть лишнее: {0}' -f (($leaked | Sort-Object -Unique) -join ', '))
    }
    Ok 'EXCLUDE: node_modules/src/src-tauri/target/dist/.git/docs/tools/.claude/*.md — отсутствуют'

    # Размер рантайма — грубая санити (Fixed Runtime ~130-180 МБ)
    try {
        $rtSizeMb = [math]::Round((Get-ChildItem -Path $rtDest -Recurse -File -ErrorAction SilentlyContinue |
                    Measure-Object -Property Length -Sum).Sum / 1MB, 1)
        Info ('Размер Fixed Runtime: ~{0} МБ' -f $rtSizeMb)
    } catch {}
}

Write-Host ''
Write-Host '=== Готово ===' -ForegroundColor Cyan
if ($WhatIfPreference) {
    Write-Host 'Это был предпросмотр (-WhatIf). Реальная упаковка не выполнялась.' -ForegroundColor Yellow
} else {
    Write-Host ('RC-папка собрана: {0}' -f $OutDir) -ForegroundColor Green
    Write-Host 'Дальше: прогнать verify-static.ps1 и ручной раздел B из tests/QA-CHECKLIST.md.' -ForegroundColor Green
    Write-Host 'Всё зелёное ⇒ переименовать/скопировать эту папку в PUBLIC (без пересборки).' -ForegroundColor Green
}
Write-Host ''
