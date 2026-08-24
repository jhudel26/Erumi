@echo off
setlocal
cd /d "%~dp0"

echo Building Erumi.exe...
echo.

python -c "import PyInstaller" 2>nul
if errorlevel 1 (
    echo PyInstaller not found. Installing...
    pip install pyinstaller
)

python -c "import customtkinter" 2>nul
if errorlevel 1 (
    echo Installing Python dependencies...
    pip install -r requirements.txt
)

pyinstaller --noconfirm build.spec
if errorlevel 1 (
    echo Trying python -m PyInstaller...
    python -m PyInstaller --noconfirm build.spec
)
if errorlevel 1 (
    echo Build failed.
    exit /b 1
)

copy /Y "yorumi-cli.cmd" "dist\yorumi-cli.cmd" >nul

echo.
echo Build complete: dist\Erumi.exe
echo.
echo Keep Erumi.exe next to yorumi-cli.cmd and yorumi-cli-main\
echo ^(or rely on an AppData YorumiCLI install^).
echo.
