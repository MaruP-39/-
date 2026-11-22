@echo off
rem Drag a video (or audio) file and its .ass subtitle onto this file.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0burn-subtitles.ps1" %*
echo.
pause
