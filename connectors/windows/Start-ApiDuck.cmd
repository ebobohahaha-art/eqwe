@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-ApiDuck.ps1" %*
if errorlevel 1 (
  echo.
  echo ApiDuck could not start. Review the message above.
  pause
  exit /b 1
)
