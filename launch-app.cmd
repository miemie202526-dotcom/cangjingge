@echo off
cd /d "%~dp0"
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process npm -ArgumentList 'start' -WorkingDirectory '%cd%' -WindowStyle Hidden"
