# Show Activity Tracker status (today's overview)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
node daemon.mjs --status
