$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$libDir = Join-Path $root "bridge\lib"
$srcDir = Join-Path $root "bridge\src\main\java"
$outDir = Join-Path $root "bridge\target\classes"
$fatDir = Join-Path $root "bridge\target\fat"
$jarPath = Join-Path $root "bridge\target\novabuild-bridge-1.0.0.jar"

New-Item -ItemType Directory -Path $libDir -Force | Out-Null
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
New-Item -ItemType Directory -Path $fatDir -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path $jarPath) -Force | Out-Null

$deps = @{
    "Java-WebSocket-1.5.6.jar" = "https://repo1.maven.org/maven2/org/java-websocket/Java-WebSocket/1.5.6/Java-WebSocket-1.5.6.jar"
    "gson-2.11.0.jar"         = "https://repo1.maven.org/maven2/com/google/code/gson/gson/2.11.0/gson-2.11.0.jar"
    "slf4j-api-2.0.9.jar"     = "https://repo1.maven.org/maven2/org/slf4j/slf4j-api/2.0.9/slf4j-api-2.0.9.jar"
    "slf4j-simple-2.0.9.jar"  = "https://repo1.maven.org/maven2/org/slf4j/slf4j-simple/2.0.9/slf4j-simple-2.0.9.jar"
}

foreach ($name in $deps.Keys) {
    $dest = Join-Path $libDir $name
    if (-not (Test-Path $dest)) {
        Write-Host "Downloading $name..."
        Invoke-WebRequest -Uri $deps[$name] -OutFile $dest -UseBasicParsing
    }
}

$jars = (Get-ChildItem $libDir -Filter "*.jar" | ForEach-Object { $_.FullName }) -join ";"
$javaFiles = Get-ChildItem $srcDir -Recurse -Filter "*.java" | ForEach-Object { $_.FullName }

Write-Host "Compiling..."
& javac -encoding UTF-8 -source 1.8 -target 1.8 -cp $jars -d $outDir $javaFiles
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Building fat JAR..."
if (Test-Path $fatDir) { Remove-Item $fatDir -Recurse -Force }
New-Item -ItemType Directory -Path $fatDir | Out-Null

Copy-Item "$outDir\*" $fatDir -Recurse -Force
foreach ($jar in Get-ChildItem $libDir -Filter "*.jar") {
    Push-Location $fatDir
    jar xf $jar.FullName
    Pop-Location
}

$manifestDir = Join-Path $fatDir "META-INF"
New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
@"
Manifest-Version: 1.0
Main-Class: com.novabuild.bridge.BridgeMain

"@ | Set-Content (Join-Path $manifestDir "MANIFEST.MF") -Encoding ASCII

if (Test-Path $jarPath) { Remove-Item $jarPath -Force }
Push-Location $fatDir
jar cfm $jarPath META-INF\MANIFEST.MF .
Pop-Location

Write-Host "Built: $jarPath"
