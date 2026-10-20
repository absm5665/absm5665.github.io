@echo off
cd /d "%~dp0"
set PORT=8899
echo.
echo   Sichuan night road - local preview
echo   serving: %~dp0
echo   open:    http://127.0.0.1:%PORT%/
echo.
echo   Keep this window open. Close it to stop the server.
echo.

set PY=
where python >nul 2>nul && set PY=python
if "%PY%"=="" ( where py >nul 2>nul && set PY=py )
if "%PY%"=="" if exist "%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\python.exe" set PY="%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\python.exe"

if "%PY%"=="" (
  echo   [!] Python not found. Install Python, or use any static file server in this folder.
  pause
  exit /b 1
)

start /min cmd /c "timeout /t 2 >nul & start "" http://127.0.0.1:%PORT%/"
%PY% -m http.server %PORT% --bind 127.0.0.1
pause
