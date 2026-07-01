$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$version = "2.0.0"
$zipName = "Nova-OP-Scripter-v$version.zip"
$zipPath = Join-Path $root $zipName

Write-Host "Packaging Nova OP-Scripter v$version..."

$icon = Join-Path $root "extension\icon.png"
if (-not (Test-Path $icon)) {
    Write-Host "Generating icon..."
    python (Join-Path $root "scripts\generate_icons.py")
    if (Test-Path (Join-Path $root "extension\icons\icon128.png")) {
        Copy-Item (Join-Path $root "extension\icons\icon128.png") $icon -Force
    }
}

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$tempDir = Join-Path $env:TEMP "Nova-pack-$([guid]::NewGuid().ToString().Substring(0,8))"
New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
    Copy-Item (Join-Path $root "extension") (Join-Path $tempDir "extension") -Recurse
    Copy-Item (Join-Path $root "novaect") (Join-Path $tempDir "novaect") -Recurse
    Copy-Item (Join-Path $root "start-novaect.bat") $tempDir -Force
    Copy-Item (Join-Path $root "README.md") $tempDir -Force
    Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force
    Write-Host "Created: $zipPath"
} finally {
    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
