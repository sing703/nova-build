@echo off
title NovaBuild Bridge
color 0A
cd /d "%~dp0"

echo.
echo === NovaBuild Bridge ===
echo.

set JAR=bridge\target\novabuild-bridge-1.0.0.jar

if exist "%JAR%" (
    echo [1/3] Looking for Java...
    where java >nul 2>&1
    if not errorlevel 1 (
        for /f "tokens=*" %%i in ('java -version 2^>^&1 ^| findstr /i "version"') do echo Found: %%i
        echo [2/3] Bridge JAR found... OK
        echo [3/3] Starting Java bridge...
        echo.
        java -jar "%JAR%"
        pause
        exit /b 0
    )
)

echo Java bridge not built or Java missing.
echo Using Python bridge ^(same connection, port 17613^)...
echo.

where py >nul 2>&1
if errorlevel 1 (
    where python >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Install Python 3 or JDK 8+ to run the bridge.
        pause
        exit /b 1
    )
    python bridge-python\bridge.py
) else (
    py -3 bridge-python\bridge.py
)
pause
