# Requires Windows x64, Node.js, Rust MSVC and Visual Studio C++ Build Tools.
[CmdletBinding()]
param([string]$WebView2Path, [string]$RuntimeCabUrl)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'This build requires Windows.' }
$root = Split-Path -Parent $PSScriptRoot
$target = 'x86_64-pc-windows-msvc'
$releaseRoot = Join-Path $root ('release-' + [guid]::NewGuid().ToString('N'))
$portable = Join-Path $releaseRoot 'Reestr-Windows-x64'
New-Item -ItemType Directory -Path $releaseRoot | Out-Null
function Check-Exit([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed: exit $LASTEXITCODE" }
}
Push-Location $root
try {
    & npm ci --no-audit --no-fund
    Check-Exit 'npm ci'
    & npm test
    Check-Exit 'Frontend tests'
    & npm run build
    Check-Exit 'Frontend build'
    Push-Location (Join-Path $root 'src-tauri')
    try {
        & cargo test --locked --target $target
        Check-Exit 'Rust tests'
    } finally { Pop-Location }
    & powershell.exe -NoProfile -File (Join-Path $PSScriptRoot 'verify-static.ps1') -RepoRoot $root
    Check-Exit 'Static verification'
    & npm run tauri -- build --no-bundle --target $target -- --locked
    Check-Exit 'Tauri Windows build'
    if (-not $WebView2Path) {
        if (-not $RuntimeCabUrl) {
            $page = (Invoke-WebRequest -UseBasicParsing 'https://developer.microsoft.com/en-us/microsoft-edge/webview2/').Content
            $page = $page.Replace('\u002F', '/').Replace('\/', '/')
            $pattern = 'https://msedge\.sf\.dl\.delivery\.mp\.microsoft\.com/[^"<>\s]+/Microsoft\.WebView2\.FixedVersionRuntime\.(?<version>[0-9.]+)\.x64\.cab'
            $candidates = @([regex]::Matches($page, $pattern) | Sort-Object { [version]$_.Groups['version'].Value } -Descending)
            if ($candidates.Count -eq 0) { throw 'Microsoft download page changed. Supply -RuntimeCabUrl from the official WebView2 page.' }
            $RuntimeCabUrl = $candidates[0].Value
        }
        $uri = [uri]$RuntimeCabUrl
        if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'msedge.sf.dl.delivery.mp.microsoft.com' -or $uri.AbsolutePath -notmatch '\.x64\.cab$') {
            throw 'Expected an official Microsoft x64 Fixed Version CAB URL.'
        }
        $cab = Join-Path $releaseRoot 'webview2.cab'
        Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $cab
        $WebView2Path = Join-Path $releaseRoot 'runtime'
        New-Item -ItemType Directory -Path $WebView2Path | Out-Null
        & expand.exe $cab '-F:*' $WebView2Path
        Check-Exit 'WebView2 extraction'
    }
    $runtimeCandidates = @(Get-ChildItem -LiteralPath $WebView2Path -Directory -Filter 'Microsoft.WebView2.FixedVersionRuntime.*.x64')
    if ((Split-Path -Leaf $WebView2Path) -like 'Microsoft.WebView2.FixedVersionRuntime.*.x64') {
        $runtimeCandidates = @(Get-Item -LiteralPath $WebView2Path)
    }
    if ($runtimeCandidates.Count -ne 1) { throw 'Expected exactly one Fixed Version runtime folder.' }
    $runtime = $runtimeCandidates[0]
    $runtimeExe = Join-Path $runtime.FullName 'msedgewebview2.exe'
    if (-not (Test-Path -LiteralPath $runtimeExe)) { throw 'Incomplete runtime: msedgewebview2.exe must be at its root.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $runtimeExe
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
        throw 'WebView2 signature verification failed.'
    }
    $exe = Join-Path $root "src-tauri/target/$target/release/reestr.exe"
    & powershell.exe -NoProfile -File (Join-Path $PSScriptRoot 'package-release.ps1') -RepoRoot $root -OutDir $portable -SkipBuild -ExePath $exe -WebView2Path $runtime.FullName -NoSampleImport
    Check-Exit 'Portable packaging'
    $metadata = [ordered]@{
        target = $target
        runtime = $runtime.Name
        runtimeSource = $RuntimeCabUrl
        rust = (& rustc --version)
        node = (& node --version)
        exeSha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
        runtimeExeSha256 = (Get-FileHash -LiteralPath $runtimeExe -Algorithm SHA256).Hash
        validation = 'Compilation and automated tests only. Windows 10/11 functional acceptance remains required.'
    }
    $metadata | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $portable 'BUILD-INFO.json')
    $zip = Join-Path $releaseRoot 'Reestr-Windows-x64.zip'
    Compress-Archive -LiteralPath $portable -DestinationPath $zip -CompressionLevel Optimal
    ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash + '  Reestr-Windows-x64.zip') | Set-Content -Encoding ASCII "$zip.sha256"
    Write-Host "Portable package: $zip"
} finally { Pop-Location }
