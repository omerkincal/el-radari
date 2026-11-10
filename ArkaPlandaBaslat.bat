@echo off
cd /d "%~dp0"
where npm >nul 2>&1
if errorlevel 1 (
    echo Masaustu modu icin once Node.js LTS kur: https://nodejs.org/
    pause
    exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        pause
        exit /b 1
    )
)
start "" "node_modules\electron\dist\electron.exe" .
