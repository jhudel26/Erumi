@echo off
setlocal
cd /d "%~dp0"

echo =======================================================
echo   Building ErumiServer.exe (Standalone Streaming App)
echo =======================================================
echo.

python -c "import PyInstaller" 2>nul
if errorlevel 1 (
    echo Installing PyInstaller...
    pip install pyinstaller
)

python -m PyInstaller --noconfirm build_server.spec
if errorlevel 1 (
    echo Build failed.
    exit /b 1
)

copy /Y "yorumi-cli.cmd" "dist\yorumi-cli.cmd" >nul
xcopy /E /I /Y "web" "dist\web" >nul
xcopy /E /I /Y "favicon" "dist\favicon" >nul

echo.
echo =======================================================
echo   Build Successful!
echo   Executable created at: dist\ErumiServer.exe
echo =======================================================
echo.
echo You can now run dist\ErumiServer.exe directly!
echo.
