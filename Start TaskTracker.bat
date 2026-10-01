@echo off
rem Daily Task Tracker launcher - double-click me.
cd /d "%~dp0"
if exist "TaskTracker.exe" (
  start "" "TaskTracker.exe"
  exit /b
)
where pythonw >nul 2>nul
if %errorlevel%==0 (
  start "" pythonw "TaskTracker.pyw"
  exit /b
)
where pyw >nul 2>nul
if %errorlevel%==0 (
  start "" pyw "TaskTracker.pyw"
  exit /b
)
echo TaskTracker.exe was not found next to this file and Python is not installed.
echo Download TaskTracker.exe (see README) and place it in this folder.
pause
