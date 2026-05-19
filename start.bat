@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo Betting Simulator - Start Script
echo ========================================
echo.

echo [1/3] Checking Node.js environment...
node --version >nul 2>&1
if errorlevel 1 (
    echo Error: Node.js not found. Please install Node.js 16+
    pause
    exit /b 1
)

echo [2/3] Starting Cloudflare Worker backend...
cd backend-worker
if not exist ".dev.vars" (
    echo Warning: backend-worker\.dev.vars not found.
    echo Copy backend-worker\.dev.vars.example to backend-worker\.dev.vars and fill Firebase/API keys for full auth and sync support.
)
if not exist "node_modules" (
    echo Installing backend-worker dependencies...
    call npm install
)
call npm run migrate:local
start "Worker API" cmd /k "npm run dev"
cd ..

echo [3/3] Starting frontend server...
cd frontend
if not exist "node_modules" (
    echo Installing frontend dependencies...
    call npm install
)
start "Frontend Server" cmd /k "npm run dev"
cd ..

echo.
echo ========================================
echo Startup completed!
echo.
echo Frontend: http://localhost:3000
echo Backend Worker API: http://localhost:8787
echo.
echo Note: Frontend /api proxy defaults to http://localhost:8787.
echo Configure backend-worker\.dev.vars for Firebase, ODDS_API_KEY, and FOOTBALL_DATA_API_KEY.
echo ========================================
pause
