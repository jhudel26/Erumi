@echo off
setlocal
cd /d "%~dp0"

echo =======================================================
echo   Erumi Anime Streaming Web Application
echo =======================================================
echo.
echo Starting local web server on port 3000...
echo.

start "" "http://localhost:3000"
python web_server.py 3000

pause
