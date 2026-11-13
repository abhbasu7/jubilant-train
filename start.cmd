@echo off
setlocal
set "PORT=3101"
if not "%~1"=="" set "PORT=%~1"

echo Local preview at http://127.0.0.1:%PORT%/
echo Press Ctrl+C to stop.
python "%~dp0server.py" "%PORT%"
exit /b %errorlevel%
