@echo off
title Multi-Platform Job Auto-Applier (Naukri + Indeed)
cd /d "%~dp0"

echo ========================================================
echo  Launching 2 Platforms: Naukri + Indeed
echo ========================================================
echo.

node index.js all --live

pause
