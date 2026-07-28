param(
    [string]$StorageAccountName = "apppkgdevstorage",
    [string]$StorageAccountKey = $env:AZURE_STORAGE_KEY
)
if (-not $StorageAccountKey) { throw "StorageAccountKey is required. Set \$env:AZURE_STORAGE_KEY or pass -StorageAccountKey." }

Write-Host "Stopping existing task..."
Stop-ScheduledTask -TaskName "PackemonWorker" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "PackemonWorker" -Confirm:$false -ErrorAction SilentlyContinue

Write-Host "Registering Scheduled Task with hardcoded credentials..."
$actionArgs = "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File C:\scripts\process_queue.ps1 -StorageAccountName $StorageAccountName -StorageAccountKey $StorageAccountKey -IntuneWinAppUtilPath C:\tools\IntuneWinAppUtil.exe"
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument $actionArgs -WorkingDirectory "C:\scripts"
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Days 0)
$principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName "PackemonWorker" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Starting the background worker task..."
Start-ScheduledTask -TaskName "PackemonWorker"

Write-Host "Task replaced and started successfully!"
