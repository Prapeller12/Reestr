# Basic Windows GUI startup check; does not replace functional Windows 10/11 acceptance.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PortablePath)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $PortablePath 'reestr.exe'
$process = Start-Process -FilePath $exe -WorkingDirectory $env:TEMP -PassThru
try {
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        Start-Sleep -Milliseconds 500
        $process.Refresh()
        if ($process.HasExited) { throw "Application exited during startup: $($process.ExitCode)" }
        $db = Join-Path $PortablePath 'data/registry.db'
        $ready = ($process.MainWindowHandle -ne 0) -and (Test-Path -LiteralPath $db)
    } until ($ready -or [DateTime]::UtcNow -gt $deadline)
    if (-not $ready) { throw 'No application window/database after 45 seconds.' }
    Start-Sleep -Seconds 3
    $process.Refresh()
    if ($process.HasExited) { throw 'Application exited after creating its window.' }
    Write-Host "Startup passed: PID=$($process.Id); window=$($process.MainWindowTitle); database=$db"
} finally {
    $process.Refresh()
    if (-not $process.HasExited) {
        $null = $process.CloseMainWindow()
        if (-not $process.WaitForExit(10000)) {
            Stop-Process -Id $process.Id -Force
            throw 'Application did not close normally within 10 seconds.'
        }
    }
}
& python -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); assert c.execute("select version from schema_version").fetchone()[0] == 4; assert c.execute("pragma integrity_check").fetchone()[0] == "ok"; assert not c.execute("pragma foreign_key_check").fetchall(); print("Database schema version 4 and integrity checks passed")' (Join-Path $PortablePath 'data/registry.db')
if ($LASTEXITCODE -ne 0) { throw 'Database verification failed.' }
