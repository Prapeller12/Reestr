<#
    verify-static.ps1 — статические гейты «Реестра писем» (QA / Release).

    Что это. Набор проверок, которые реально выполнимы над ИСХОДНИКАМИ ДО сборки
    (Rust/cargo и запуск приложения здесь не нужны). Каждый гейт печатает PASS / FAIL / WARN.
    При ЛЮБОМ FAIL скрипт завершается ненулевым кодом (exit 1) — годится для CI-гейта.

    Что этот скрипт НЕ проверяет (остаётся ручным чек-листом tests/QA-CHECKLIST.md, раздел B):
    чистая ВМ без WebView2, трафик = 0, ProcMon «нет следов», USB / не-админ путь, печать в PDF,
    доменные truth-table в живом UI — всё это требует собранного exe и запуска.

    Основание: docs/plans/qa-publish.md (§4 офлайн, §10 release, §11 гейт),
                docs/plans/backend.md (§2 схема, §3 пути, §5 build, §10 контракт команд),
                КОНЦЕПЦИЯ.md §0 (6 принципов).

    Запуск:
        powershell -ExecutionPolicy Bypass -File scripts\verify-static.ps1
#>

[CmdletBinding()]
param(
    # Корень репозитория. По умолчанию — родитель папки scripts\ (вычисляется ниже).
    [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

# Каталог скрипта. $PSScriptRoot в param-default ненадёжен в части хостов — резолвим в теле.
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $RepoRoot)  { $RepoRoot  = Split-Path -Parent $ScriptDir }

# Консоль в UTF-8, чтобы кириллица в выводе не ломалась.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# --- Счётчики итога -------------------------------------------------------
$script:Failures = 0
$script:Warnings = 0
$script:Passes   = 0

function Write-Gate {
    param(
        [ValidateSet('PASS', 'FAIL', 'WARN', 'INFO')][string]$Status,
        [string]$Name,
        [string]$Detail = ''
    )
    switch ($Status) {
        'PASS' { $color = 'Green';  $script:Passes++ }
        'FAIL' { $color = 'Red';    $script:Failures++ }
        'WARN' { $color = 'Yellow'; $script:Warnings++ }
        default { $color = 'Gray' }
    }
    Write-Host ('[{0}] ' -f $Status) -ForegroundColor $color -NoNewline
    Write-Host $Name
    if ($Detail) {
        foreach ($line in ($Detail -split "`n")) {
            Write-Host ('       {0}' -f $line) -ForegroundColor DarkGray
        }
    }
}

# Собрать список файлов по маскам под каталогом (пусто, если каталога нет).
function Get-SourceFiles {
    param([string]$Root, [string[]]$Include)
    if (-not (Test-Path $Root)) { return @() }
    return Get-ChildItem -Path $Root -Recurse -File -Include $Include -ErrorAction SilentlyContinue
}

# Строки-совпадения по regex (без учёта регистра выключается флагом -CaseSensitive у Select-String).
function Select-Lines {
    param([System.IO.FileInfo[]]$Files, [string]$Pattern)
    if (-not $Files -or $Files.Count -eq 0) { return @() }
    return Select-String -Path ($Files.FullName) -Pattern $Pattern -AllMatches -ErrorAction SilentlyContinue
}

# Красиво отформатировать совпадения "путь:строка: текст" (относительно RepoRoot).
function Format-Hits {
    param($Hits, [int]$Max = 12)
    $rows = @()
    $i = 0
    foreach ($h in $Hits) {
        if ($i -ge $Max) { $rows += ('… ещё {0}' -f ($Hits.Count - $Max)); break }
        $rel = $h.Path
        try { $rel = Resolve-Path -Relative -Path $h.Path -ErrorAction SilentlyContinue } catch {}
        $rows += ('{0}:{1}: {2}' -f $rel, $h.LineNumber, $h.Line.Trim())
        $i++
    }
    return ($rows -join "`n")
}

$SrcDir      = Join-Path $RepoRoot 'src'
$TauriSrc    = Join-Path $RepoRoot 'src-tauri\src'
$ComponentsDir = Join-Path $SrcDir 'components'
$CargoToml   = Join-Path $RepoRoot 'src-tauri\Cargo.toml'
$TauriConf   = Join-Path $RepoRoot 'src-tauri\tauri.conf.json'
$MigrationSql = Join-Path $RepoRoot 'src-tauri\migrations\0001_init.sql'
$CommandsTs  = Join-Path $SrcDir 'api\commands.ts'
$CommandsRs  = Join-Path $TauriSrc 'commands.rs'
$MainTsx     = Join-Path $SrcDir 'main.tsx'

Write-Host ''
Write-Host '=== verify-static.ps1 — статические гейты релиза «Реестр писем» ===' -ForegroundColor Cyan
Write-Host ('Репозиторий: {0}' -f $RepoRoot) -ForegroundColor DarkGray
Write-Host ''

# ==========================================================================
# ГЕЙТ 1 — Офлайн (принцип 1): нет внешних URL в исходниках фронта.
#   В src/**/*.{ts,tsx,css} не должно быть http(s)://, кроме xmlns="http://www.w3.org/..."
#   в SVG (пространство имён — не сетевая загрузка).
# ==========================================================================
$srcFiles = Get-SourceFiles -Root $SrcDir -Include @('*.ts', '*.tsx', '*.css')
$urlHits  = Select-Lines -Files $srcFiles -Pattern 'https?://'
# Отфильтровать легальные исключения: xmlns / w3.org (SVG-namespace).
$urlHits  = @($urlHits | Where-Object { $_.Line -notmatch 'xmlns' -and $_.Line -notmatch 'w3\.org' })
if ($urlHits.Count -eq 0) {
    Write-Gate PASS 'Офлайн (принцип 1): 0 внешних URL в src/**/*.{ts,tsx,css}'
} else {
    Write-Gate FAIL ('Офлайн (принцип 1): найдено внешних URL — {0}' -f $urlHits.Count) (Format-Hits $urlHits)
}

# ==========================================================================
# ГЕЙТ 2 — Дисциплина стилей (правила проекта + frontend.md §0).
#   2a) в .tsx только className, не class=
#   2b) нет inline style={ ... } — кроме src/components/timeline/** (геометрия)
#   2c) в src/components/** нет import '*.css'
#   2d) единственный CSS-импорт — index.css в main.tsx
# ==========================================================================
$tsxFiles = Get-SourceFiles -Root $SrcDir -Include @('*.tsx')

# 2a — class= (но не className=). \bclass\s*= не матчит className, т.к. после class идёт 'N'.
$classHits = @(Select-Lines -Files $tsxFiles -Pattern '\bclass\s*=')
if ($classHits.Count -eq 0) {
    Write-Gate PASS 'Стили 2a: class= отсутствует (везде className)'
} else {
    Write-Gate FAIL ('Стили 2a: найден class= — {0}' -f $classHits.Count) (Format-Hits $classHits)
}

# 2b — inline style={ (ловит и обход через переменную: style={styleObj}).
#   ИСКЛЮЧЕНИЕ: src/components/timeline/** — вычисляемая геометрия таймлайна
#   (позиции плашек, линий связей, ширина трека) выражается только координатами
#   в пикселях и классами не описывается. Оформление таймлайна — в blocks/timeline.
$timelineDir = Join-Path $ComponentsDir 'timeline'
$styleScope  = @($tsxFiles | Where-Object { -not $_.FullName.StartsWith($timelineDir, [System.StringComparison]::OrdinalIgnoreCase) })
$styleHits   = @(Select-Lines -Files $styleScope -Pattern 'style\s*=\s*\{')
if ($styleHits.Count -eq 0) {
    Write-Gate PASS 'Стили 2b: inline style={ } отсутствует (кроме геометрии таймлайна)'
} else {
    Write-Gate FAIL ('Стили 2b: найден inline style={ — {0}' -f $styleHits.Count) (Format-Hits $styleHits)
}

# 2c — import '*.css' внутри src/components/**
$compFiles = Get-SourceFiles -Root $ComponentsDir -Include @('*.ts', '*.tsx')
$cssImportHits = @(Select-Lines -Files $compFiles -Pattern "import\s+['""][^'""]*\.css['""]")
if ($cssImportHits.Count -eq 0) {
    Write-Gate PASS 'Стили 2c: в src/components/** нет import ''*.css'''
} else {
    Write-Gate FAIL ('Стили 2c: CSS-импорт в компонентах — {0}' -f $cssImportHits.Count) (Format-Hits $cssImportHits)
}

# 2d — единственный CSS-импорт во всём src — index.css в main.tsx
$allTs = Get-SourceFiles -Root $SrcDir -Include @('*.ts', '*.tsx')
$allCssImports = @(Select-Lines -Files $allTs -Pattern "import\s+['""][^'""]*\.css['""]")
$badCssImports = @($allCssImports | Where-Object {
        -not (($_.Path -ieq $MainTsx) -and ($_.Line -match "index\.css"))
    })
if ($allCssImports.Count -ge 1 -and $badCssImports.Count -eq 0) {
    Write-Gate PASS 'Стили 2d: единственный CSS-импорт — index.css в main.tsx'
} elseif ($allCssImports.Count -eq 0) {
    Write-Gate FAIL 'Стили 2d: не найдено ни одного импорта index.css (ожидался в main.tsx)'
} else {
    Write-Gate FAIL 'Стили 2d: посторонние CSS-импорты помимо index.css в main.tsx' (Format-Hits $badCssImports)
}

# ==========================================================================
# ГЕЙТ 3 — Статус только с бэкенда (инвариант §5.6.1) — ЭВРИСТИКА grep.
#   Фронт не должен вычислять доменный статус/срок. ЖЁСТКИЙ признак нарушения:
#   работа со временем на клиенте — Date.now( или new Date(. МЯГКИЙ (WARN, ручная
#   сверка): regDate в арифметике / '+ 30' / сравнение с today. ВНИМАНИЕ: отображение
#   doc.regDate, текст-лейбл «regDate + 30» и сортировка по dueDate — легальны;
#   поэтому мягкая часть только предупреждает, а решение — за ревьюером.
# ==========================================================================
$compTsx = Get-SourceFiles -Root $ComponentsDir -Include @('*.tsx', '*.ts')
$hardTime = @(Select-Lines -Files $compTsx -Pattern 'Date\.now\(|new\s+Date\(')
if ($hardTime.Count -eq 0) {
    Write-Gate PASS 'Статус с бэкенда (жёстко): нет Date.now( / new Date( в компонентах'
} else {
    Write-Gate FAIL ('Статус с бэкенда: клиент работает со временем — {0}' -f $hardTime.Count) (Format-Hits $hardTime)
}
# Мягкая эвристика: regDate с арифметикой или сравнение с today. Строки-комментарии
# (// или * ...) отбрасываем — в них исполняемой логики нет; остаются код и JSX-текст.
$softHits = @(Select-Lines -Files $compTsx -Pattern 'regDate\s*[\+\-]\s*\d|[<>]\s*today|today\s*[<>]' |
    Where-Object { $_.Line.Trim() -notmatch '^(//|\*|/\*)' })
if ($softHits.Count -eq 0) {
    Write-Gate PASS 'Статус с бэкенда (эвристика): нет арифметики regDate / сравнений с today'
} else {
    Write-Gate WARN ('Статус с бэкенда (эвристика): {0} совпадений — сверить вручную (лейбл/текст — ОК)' -f $softHits.Count) (Format-Hits $softHits)
}

# ==========================================================================
# ГЕЙТ 4 — Пути от бинаря (принцип 4): в src-tauri/src/** есть current_exe(,
#   и НЕТ current_dir( (CWD подменяется ярлыком/ассоциацией — БД «уедет»).
# ==========================================================================
$rsFiles = Get-SourceFiles -Root $TauriSrc -Include @('*.rs')
$hasCurrentExe = @(Select-Lines -Files $rsFiles -Pattern 'current_exe\(').Count -gt 0
$currentDirHits = @(Select-Lines -Files $rsFiles -Pattern 'current_dir\(')  # с ( — комментарий «current_dir)» не ловится
if ($hasCurrentExe -and $currentDirHits.Count -eq 0) {
    Write-Gate PASS 'Пути от бинаря (принцип 4): есть current_exe(, нет current_dir('
} elseif (-not $hasCurrentExe) {
    Write-Gate FAIL 'Пути от бинаря: не найден current_exe( в src-tauri/src/**'
} else {
    Write-Gate FAIL ('Пути от бинаря: найден current_dir( — {0}' -f $currentDirHits.Count) (Format-Hits $currentDirHits)
}

# ==========================================================================
# ГЕЙТ 5 — Нет updater (принцип 1): ни в Cargo.toml, ни в tauri.conf.json.
# ==========================================================================
$updaterHits = @()
if (Test-Path $CargoToml)  { $updaterHits += @(Select-String -Path $CargoToml -Pattern 'updater|tauri-plugin-updater' -ErrorAction SilentlyContinue) }
if (Test-Path $TauriConf)  { $updaterHits += @(Select-String -Path $TauriConf -Pattern '"updater"|updater'          -ErrorAction SilentlyContinue) }
$updaterHits = @($updaterHits | Where-Object { $_ -ne $null })
if ($updaterHits.Count -eq 0) {
    Write-Gate PASS 'Нет updater (принцип 1): в Cargo.toml и tauri.conf.json секции updater нет'
} else {
    Write-Gate FAIL ('Нет updater: найдены упоминания updater — {0}' -f $updaterHits.Count) (Format-Hits $updaterHits)
}

# ==========================================================================
# ГЕЙТ 6 — привязка Fixed WebView2 Runtime (принцип 2, backend.md §4).
#   Портативность обеспечивает НЕ бандлер-инсталлятор (отгрузка через
#   `tauri build --no-bundle` — папка, а не установщик), а РАНТАЙМ: lib.rs выставляет
#   env WEBVIEW2_BROWSER_EXECUTABLE_FOLDER на вшитый рантайм рядом с exe. Поэтому:
#     - lib.rs ДОЛЖЕН выставлять WEBVIEW2_BROWSER_EXECUTABLE_FOLDER (FAIL иначе);
#     - package-release.ps1 ДОЛЖЕН копировать папку FixedVersionRuntime в PUBLIC (WARN иначе);
#     - webviewInstallMode = skip (бандлер рантайм не тянет; убрал placeholder-путь,
#       который ломал сборку) — информативный PASS.
# ==========================================================================
$LibRs     = Join-Path $RepoRoot 'src-tauri\src\lib.rs'
$PkgScript = Join-Path $RepoRoot 'scripts\package-release.ps1'
if (Test-Path $LibRs) {
    if ((Get-Content -Path $LibRs -Raw) -match 'WEBVIEW2_BROWSER_EXECUTABLE_FOLDER') {
        Write-Gate PASS 'Fixed runtime: lib.rs привязывает рантайм через WEBVIEW2_BROWSER_EXECUTABLE_FOLDER'
    } else {
        Write-Gate FAIL 'Fixed runtime: в lib.rs нет WEBVIEW2_BROWSER_EXECUTABLE_FOLDER — рантайм не привязан'
    }
} else {
    Write-Gate FAIL ('Fixed runtime: не найден lib.rs — {0}' -f $LibRs)
}
if (Test-Path $PkgScript) {
    if ((Get-Content -Path $PkgScript -Raw) -match 'FixedVersionRuntime') {
        Write-Gate PASS 'Fixed runtime: package-release.ps1 копирует папку FixedVersionRuntime в PUBLIC'
    } else {
        Write-Gate WARN 'Fixed runtime: package-release.ps1 не упоминает FixedVersionRuntime — проверить шаг копирования рантайма'
    }
} else {
    Write-Gate WARN ('Fixed runtime: package-release.ps1 не найден — {0}' -f $PkgScript)
}
if ((Test-Path $TauriConf) -and ((Get-Content -Path $TauriConf -Raw) -match '"skip"')) {
    Write-Gate PASS 'Fixed runtime: webviewInstallMode=skip (отгрузка через --no-bundle; рантайм — env+копирование, не бандлер)'
}

# ==========================================================================
# ГЕЙТ 7 — SQLite bundled (принцип 2, backend.md §2/§5): rusqlite с feature "bundled".
# ==========================================================================
if (Test-Path $CargoToml) {
    $cargoRaw = Get-Content -Path $CargoToml -Raw
    if ($cargoRaw -match 'rusqlite' -and $cargoRaw -match 'bundled') {
        Write-Gate PASS 'SQLite bundled: rusqlite с feature "bundled" в Cargo.toml'
    } else {
        Write-Gate FAIL 'SQLite bundled: не найден rusqlite с feature "bundled"'
    }
} else {
    Write-Gate FAIL ('SQLite bundled: Cargo.toml не найден — {0}' -f $CargoToml)
}

# ==========================================================================
# ГЕЙТ 8 — Миграция на месте (backend.md §2.1): 0001_init.sql существует и содержит
#   6 таблиц: DOCUMENT, LINK, THEME, THEME_ASSIGNMENT, DEADLINE, IMPORT_BATCH.
# ==========================================================================
$expectedTables = @('DOCUMENT', 'LINK', 'THEME', 'THEME_ASSIGNMENT', 'DEADLINE', 'IMPORT_BATCH')
if (Test-Path $MigrationSql) {
    $sqlRaw = Get-Content -Path $MigrationSql -Raw
    $found = [regex]::Matches($sqlRaw, '(?im)^\s*CREATE\s+TABLE\s+(\w+)') | ForEach-Object { $_.Groups[1].Value.ToUpper() }
    $found = @($found | Sort-Object -Unique)
    $missing = @($expectedTables | Where-Object { $found -notcontains $_ })
    if ($missing.Count -eq 0) {
        Write-Gate PASS ('Миграция 0001_init.sql: все 6 таблиц на месте ({0})' -f ($expectedTables -join ', '))
    } else {
        Write-Gate FAIL ('Миграция 0001_init.sql: не хватает таблиц — {0}' -f ($missing -join ', ')) ('Найдены: ' + ($found -join ', '))
    }
} else {
    Write-Gate FAIL ('Миграция: файл не найден — {0}' -f $MigrationSql)
}

# ==========================================================================
# ГЕЙТ 9 — Контракт-шов: множество имён команд фронта (call('...') в
#   src/api/commands.ts) == множество #[tauri::command]-функций в
#   src-tauri/src/commands.rs. Ожидается ровно 22 (qa2-backend.md — батч 2 добавил
#   set_field_override/clear_field_override/get_field_suggestions; qa3-f4-backend.md — +delete_theme).
#   FAIL при расхождении.
#   ПРИМЕЧАНИЕ: в commands.ts строки-имена приходят как аргумент врапперу call(),
#   а не напрямую в invoke() (invoke принимает переменную cmd) — поэтому ищем call('...').
# ==========================================================================
$frontNames = @()
$backNames  = @()
if (Test-Path $CommandsTs) {
    $tsRaw = Get-Content -Path $CommandsTs -Raw
    $frontNames = [regex]::Matches($tsRaw, "call\(\s*'([a-z_]+)'") | ForEach-Object { $_.Groups[1].Value }
    # Подстраховка: если появятся прямые invoke('name') — тоже учесть.
    $frontNames += [regex]::Matches($tsRaw, "invoke(?:<[^>]*>)?\(\s*'([a-z_]+)'") | ForEach-Object { $_.Groups[1].Value }
    $frontNames = @($frontNames | Sort-Object -Unique)
}
if (Test-Path $CommandsRs) {
    $rsRaw = Get-Content -Path $CommandsRs -Raw
    $backNames = [regex]::Matches($rsRaw, '(?s)#\[tauri::command\].*?fn\s+(\w+)') | ForEach-Object { $_.Groups[1].Value }
    $backNames = @($backNames | Sort-Object -Unique)
}
$onlyFront = @($frontNames | Where-Object { $backNames -notcontains $_ })
$onlyBack  = @($backNames  | Where-Object { $frontNames -notcontains $_ })
if ($frontNames.Count -gt 0 -and $onlyFront.Count -eq 0 -and $onlyBack.Count -eq 0) {
    Write-Gate PASS ('Контракт-шов: множества команд совпадают ({0} шт.)' -f $frontNames.Count)
    if ($frontNames.Count -ne 22) {
        Write-Gate WARN ('Контракт-шов: количество команд = {0}, ожидалось 22 (qa3-f4-backend.md)' -f $frontNames.Count)
    }
} else {
    $detail = @()
    if ($onlyFront.Count -gt 0) { $detail += 'Только во фронте (call/invoke): ' + ($onlyFront -join ', ') }
    if ($onlyBack.Count  -gt 0) { $detail += 'Только в бэке (#[tauri::command]): ' + ($onlyBack -join ', ') }
    $detail += ('front={0}, back={1}' -f $frontNames.Count, $backNames.Count)
    Write-Gate FAIL 'Контракт-шов: множества команд расходятся' ($detail -join "`n")
}

# ==========================================================================
# Итог
# ==========================================================================
Write-Host ''
Write-Host '=== Итог ===' -ForegroundColor Cyan
Write-Host ('  PASS: {0}   WARN: {1}   FAIL: {2}' -f $script:Passes, $script:Warnings, $script:Failures)
Write-Host ''
if ($script:Failures -gt 0) {
    Write-Host 'РЕЗУЛЬТАТ: FAIL — статические гейты не пройдены, промоушен RC → PUBLIC запрещён.' -ForegroundColor Red
    exit 1
} else {
    if ($script:Warnings -gt 0) {
        Write-Host 'РЕЗУЛЬТАТ: PASS (с предупреждениями) — разобрать WARN перед паблишем.' -ForegroundColor Yellow
    } else {
        Write-Host 'РЕЗУЛЬТАТ: PASS — статические гейты пройдены.' -ForegroundColor Green
    }
    exit 0
}
