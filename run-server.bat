@echo off
rem اجرای بی‌صدا برای کار زمان‌بندی‌شده — بدون پنجره و بدون pause
chcp 65001 >nul
cd /d "%~dp0"
node server.js >> "data\service.log" 2>&1
