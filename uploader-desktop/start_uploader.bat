@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [SpeakEcho] Starting uploader desktop app...
echo Note: This window stays open until you close the GUI. That is normal.
echo.

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" main.py
  if not errorlevel 1 goto end_ok
  echo.
  echo [.venv failed; trying py launcher. To fix, run in this folder:]
  echo   py -3.14 -m venv .venv --clear
  echo   .venv\Scripts\pip install --no-cache-dir -r requirements.txt
  echo.
)

where py >nul 2>&1
if not errorlevel 1 (
  py -3.14 main.py
  if not errorlevel 1 goto end_ok
  py -3 main.py
  if not errorlevel 1 goto end_ok
)

python main.py
if not errorlevel 1 goto end_ok

echo.
echo Failed to start. Install deps in this folder:
echo   py -3.14 -m venv .venv
echo   .venv\Scripts\pip install --no-cache-dir -r requirements.txt
pause

:end_ok
endlocal
