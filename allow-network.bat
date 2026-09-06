@echo off
chcp 65001 >nul
rem باز کردن راه عبور فایروال ویندوز فقط برای شبکه محلی.
rem این فایل را با کلیک راست و «Run as administrator» اجرا کنید.

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   این فایل باید با دسترسی مدیر اجرا شود.
  echo   کلیک راست روی فایل، سپس "Run as administrator".
  echo.
  pause
  exit /b 1
)

set PORT=8080
netsh advfirewall firewall delete rule name="سامانه قراردادها" >nul 2>&1
netsh advfirewall firewall add rule name="سامانه قراردادها" ^
  dir=in action=allow protocol=TCP localport=%PORT% profile=private,domain

echo.
echo   پورت %PORT% فقط روی شبکه خصوصی و دامنه باز شد.
echo   روی پروفایل Public عمداً باز نشده است تا در شبکه‌های ناشناس در دسترس نباشد.
echo.
pause
