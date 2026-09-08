@echo off
title Multi-Platform Job Auto-Applier (Wellfound + Naukri + Indeed)
cd /d "%~dp0"

echo ========================================================
echo  Launching 3 Platforms: Wellfound + Naukri + Indeed
echo ========================================================
echo.

node index.js all --live

pause
