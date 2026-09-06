@echo off
chcp 65001 >nul
title سامانه مدیریت قراردادها
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js روی این سیستم پیدا نشد.
  echo   نصب‌کننده ویندوزی آن ^(node-vXX-x64.msi^) را از یک رایانه دارای اینترنت
  echo   بگیرید، روی این سرور ببرید و نصب کنید. سپس دوباره این فایل را اجرا کنید.
  echo.
  pause
  exit /b 1
)

node server.js
echo.
echo   سامانه متوقف شد.
pause
