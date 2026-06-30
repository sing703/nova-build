$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$version = "1.0.0"
$zipName = "NovaBuild-v$version.zip"
$zipPath = Join-Path $root $zipName

Write-Host "Packaging NovaBuild v$version..."

# Generate icons if missing
$iconDir = Join-Path $root "extension\icons\icon128.png"
if (-not (Test-Path $iconDir)) {
    Write-Host "Generating icons..."
    python (Join-Path $root "scripts\generate_icons.py")
}

# Build Java bridge (requires JDK 8+)
$jar = Join-Path $root "bridge\target\novabuild-bridge-1.0.0.jar"
if (-not (Test-Path $jar)) {
    Write-Host "Building Java bridge (needs JDK)..."
    try {
        powershell -ExecutionPolicy Bypass -File (Join-Path $root "scripts\build-bridge.ps1")
    } catch {
        Write-Host "Java build skipped - Python bridge included as fallback."
    }
}

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$tempDir = Join-Path $env:TEMP "NovaBuild-pack-$([guid]::NewGuid().ToString().Substring(0,8))"
New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
    # Copy extension (exclude dev files)
    $extDest = Join-Path $tempDir "extension"
    Copy-Item (Join-Path $root "extension") $extDest -Recurse

    # Copy bridge files
    if (Test-Path $jar) {
        New-Item -ItemType Directory -Path (Join-Path $tempDir "bridge\target") -Force | Out-Null
        Copy-Item $jar (Join-Path $tempDir "bridge\target\") -Force
        Copy-Item (Join-Path $root "bridge\pom.xml") (Join-Path $tempDir "bridge\") -Force
    }
    Copy-Item (Join-Path $root "start-bridge.bat") $tempDir -Force
    Copy-Item (Join-Path $root "bridge-python") (Join-Path $tempDir "bridge-python") -Recurse
    Copy-Item (Join-Path $root "README.md") $tempDir -Force

    Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force
    Write-Host "Created: $zipPath"
} finally {
    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
