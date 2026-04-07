@echo off
setlocal

REM Get the script directory
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

echo ===================================================
echo      Starting Tally Stock App (SF Srikakulam)
echo ===================================================

echo.
echo [1/3] Checking Backend...
if not exist "Backend\node_modules" (
    echo Installing backend dependencies...
    cd Backend
    call npm install
    cd ..
)

echo Starting Backend Server...
start "SF Backend (Port 3000)" cmd /k "cd /d "%SCRIPT_DIR%Backend" && npm start"

echo.
echo [2/3] Checking Frontend...
if not exist "Frontend\node_modules" (
    echo Installing frontend dependencies...
    cd Frontend
    call npm install
    cd ..
)

echo Starting Frontend Dev Server...
start "SF Frontend" cmd /k "cd /d "%SCRIPT_DIR%Frontend" && npm run dev"

echo.
echo ===================================================
echo      App started!
echo      Backend: http://localhost:3000
echo      Frontend: Check the Vite terminal
echo ===================================================
echo.
