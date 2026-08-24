@echo off
setlocal
set "ROOT=%~dp0yorumi-cli-main"
set "ENTRY=%ROOT%\bin\yorumi-cli.cjs"

if not exist "%ENTRY%" (
  echo Yorumi CLI not found at "%ENTRY%"
  exit /b 1
)

where node >nul 2>&1
if %ERRORLEVEL%==0 (
  node "%ENTRY%" %*
  exit /b %ERRORLEVEL%
)

if exist "%ProgramFiles%\nodejs\node.exe" (
  "%ProgramFiles%\nodejs\node.exe" "%ENTRY%" %*
  exit /b %ERRORLEVEL%
)

echo Node.js was not found. Install Node.js, then try again.
exit /b 1
