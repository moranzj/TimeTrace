@echo off
rem 时迹 TimeTrace · Windows 一键安装（双击本文件即可）
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [x] 需要 Node.js ^>= 18：https://nodejs.org/
  pause
  exit /b 1
)

node bin\timetrace.mjs install
if errorlevel 1 (
  echo [x] 安装过程中出现问题，请把上面的输出发到 GitHub Issues
  pause
  exit /b 1
)

echo.
echo [OK] 完成。双击桌面「时迹」图标即可打开面板。
pause
