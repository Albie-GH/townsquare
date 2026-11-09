@echo off
setlocal
rem Put this file in the townsquare folder (next to package.json) and double-click it.
cd /d "%~dp0"

rem Path to the session server file, relative to this folder. Change it if yours differs.
set "SERVER_FILE=server\index.js"

if not exist "%SERVER_FILE%" (
  echo Could not find %SERVER_FILE%
  echo Edit SERVER_FILE at the top of this file to point at the session server.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo node_modules not found, running npm install first...
  call npm install
)

rem Use cloudflared.exe from this folder if it is here, otherwise from PATH.
set "CF=cloudflared"
if exist "%~dp0cloudflared.exe" (
  set "CF=%~dp0cloudflared.exe"
) else (
  where cloudflared >nul 2>nul
  if errorlevel 1 (
    echo cloudflared.exe not found. Copy it into this folder or add it to PATH.
    pause
    exit /b 1
  )
)

echo Starting session server, voice server, app and tunnel...

start "1 - Session server" cmd /k "set NODE_ENV=development&& node %SERVER_FILE%"
start "2 - Voice server" cmd /k "node voice-server.js"
start "3 - App" cmd /k "npm run serve"

rem Give the app a moment before opening the tunnel
timeout /t 5 /nobreak >nul
start "4 - Tunnel" cmd /k ""%CF%" tunnel --url http://localhost:8080"

echo.
echo All four windows are open.
echo Wait until window 3 says the app is running, then look in window 4
echo for the https://something.trycloudflare.com link and share that.
echo Close the four windows to stop everything.
echo.
pause
