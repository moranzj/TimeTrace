# Register Activity Tracker to start at logon (Task Scheduler)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs = Join-Path $root 'start.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '"') -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'ActivityTracker' -Action $action -Trigger $trigger -Settings $settings -Description 'Activity tracker: foreground apps + screenshots every 10s' -Force | Out-Null
Write-Host '[OK] startup task "ActivityTracker" registered.'
Write-Host ('Start it now:  wscript.exe "' + $vbs + '"')
