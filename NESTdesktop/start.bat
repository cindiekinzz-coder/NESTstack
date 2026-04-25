@echo off
title NESTeq Community
echo.
echo   NESTeq Community
echo   =================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo   ERROR: Node.js not found.
    echo   Download it from https://nodejs.org ^(LTS version^)
    echo.
    echo   Press any key to exit...
    pause >nul
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo   Installing dependencies ^(first time only^)...
    npm install --production 2>nul
    echo   Done.
    echo.
)

:: Check port
netstat -ano 2>nul | findstr ":3456.*LISTENING" >nul 2>nul
if %errorlevel% equ 0 (
    echo   Port 3456 is already in use.
    echo   NESTeq Community might already be running.
    echo   Opening browser...
    start http://localhost:3456
    echo.
    echo   Press any key to exit...
    pause >nul
    exit /b 0
)

echo   Starting dashboard on http://localhost:3456
echo   Press Ctrl+C to stop.
echo.

:: Open browser after server has time to start
start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3456"

:: Run the server (blocks until Ctrl+C)
node local-agent.js
