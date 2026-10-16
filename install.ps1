# 时迹 TimeTrace · Windows 安装（在项目目录内用 PowerShell 运行：powershell -ExecutionPolicy Bypass -File install.ps1）
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '✗ 需要 Node.js >= 18：https://nodejs.org/' -ForegroundColor Red
  exit 1
}

node bin/timetrace.mjs install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host '完成。双击桌面「时迹」图标即可打开面板。' -ForegroundColor Green
