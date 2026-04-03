@echo off
chcp 65001 >nul
cd /d "%~dp0"

pythonw -m bilingual_packager.gui 2>nul
if not errorlevel 1 exit /b 0

py -3w -m bilingual_packager.gui 2>nul
if not errorlevel 1 exit /b 0

py -3 -m bilingual_packager.gui 2>nul
if not errorlevel 1 exit /b 0

echo.
echo 未能启动图形界面。请确认已安装 Python，并在本目录执行：
echo   python -m pip install -r bilingual_packager\requirements.txt
echo 然后可再双击本 bat，或使用：
echo   pythonw -m bilingual_packager.gui
echo.
pause
exit /b 1
