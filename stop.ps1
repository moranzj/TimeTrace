# Stop Activity Tracker (daemon + capture child)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$run = Join-Path $root 'data\run'
$any = $false
foreach ($name in @('capture', 'daemon')) {
  $pf = Join-Path $run "$name.pid"
  if (Test-Path $pf) {
    $procId = 0
    [void][int]::TryParse((Get-Content $pf -Raw).Trim(), [ref]$procId)
    if ($procId -gt 0) {
      try {
        Stop-Process -Id $procId -Force -ErrorAction Stop
        Write-Host "[OK] stopped $name (PID $procId)"
        $any = $true
      } catch {
        Write-Host "[--] $name (PID $procId) was not running"
      }
    }
    Remove-Item $pf -Force -ErrorAction SilentlyContinue
  } else {
    Write-Host "[--] $name not running (no pid file)"
  }
}
if (-not $any) { Write-Host "Activity tracker is not running." }
