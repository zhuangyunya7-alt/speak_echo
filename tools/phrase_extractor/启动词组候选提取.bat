@echo off
chcp 65001 >nul
cd /d "%~dp0.."

pythonw -m phrase_extractor.gui 2>nul
if not errorlevel 1 exit /b 0

py -3w -m phrase_extractor.gui 2>nul
if not errorlevel 1 exit /b 0

py -3 -m phrase_extractor.gui 2>nul
if not errorlevel 1 exit /b 0

echo.
echo 未能启动图形界面。请确认已安装 Python，并在上级 tools 目录下可执行：
echo   py -3 -m phrase_extractor.gui
echo.
pause
exit /b 1
