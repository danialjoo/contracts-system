@echo off
chcp 65001 >nul
rem اجرای دائمی سامانه با کار زمان‌بندی‌شده ویندوز — بدون نیاز به دانلود ابزار.
rem با دسترسی مدیر اجرا کنید.

net session >nul 2>&1
if errorlevel 1 (
  echo   این فایل باید با دسترسی مدیر اجرا شود ^("Run as administrator"^).
  pause
  exit /b 1
)

cd /d "%~dp0"
schtasks /delete /tn "سامانه قراردادها" /f >nul 2>&1
schtasks /create /tn "سامانه قراردادها" /tr "\"%~dp0run-server.bat\"" ^
  /sc onstart /ru SYSTEM /rl HIGHEST /f

echo.
echo   کار زمان‌بندی‌شده ساخته شد. سامانه با هر بار روشن شدن سرور بالا می‌آید.
echo   برای شروع همین حالا:  schtasks /run /tn "سامانه قراردادها"
echo   برای توقف:            schtasks /end /tn "سامانه قراردادها"
echo.
pause
