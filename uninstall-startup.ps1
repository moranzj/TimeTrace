# Remove Activity Tracker startup task
Unregister-ScheduledTask -TaskName 'ActivityTracker' -Confirm:$false -ErrorAction SilentlyContinue
Write-Host '[OK] startup task "ActivityTracker" removed (if it existed).'
