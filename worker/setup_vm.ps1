# worker-setup-script for the Azure VM
param (
    [Parameter(Mandatory=$true)]
    [string]$StorageConnectionString
)

$ErrorActionPreference = "Stop"

Write-Host "Creating directories..."
New-Item -ItemType Directory -Force -Path "C:\tools" | Out-Null
New-Item -ItemType Directory -Force -Path "C:\scripts" | Out-Null

Write-Host "Downloading Microsoft IntuneWinAppUtil.exe..."
Invoke-WebRequest -Uri "https://github.com/microsoft/Microsoft-Win32-Content-Prep-Tool/raw/master/IntuneWinAppUtil.exe" -OutFile "C:\tools\IntuneWinAppUtil.exe"

Write-Host "Downloading all scripts from Blob Storage..."
$StorageAccountName = ($StorageConnectionString -split ';' | Where-Object { $_ -match "^AccountName=" } | ForEach-Object { $_ -replace "^AccountName=","" })
$StorageAccountKey = ($StorageConnectionString -split ';' | Where-Object { $_ -match "^AccountKey=" } | ForEach-Object { $_ -replace "^AccountKey=","" })
$ContainerName = "scripts"

Write-Host "Configuring NuGet and installing Az.Storage module..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force | Out-Null
if (-not (Get-Module -ListAvailable -Name Az.Storage)) {
    Install-Module -Name Az.Storage -Force -AllowClobber -Scope AllUsers -SkipPublisherCheck | Out-Null
}
Import-Module Az.Storage

$context = New-AzStorageContext -StorageAccountName $StorageAccountName -StorageAccountKey $StorageAccountKey

$blobs = Get-AzStorageBlob -Container $ContainerName -Context $context
foreach ($blob in $blobs) {
    Write-Host "Downloading $($blob.Name)..."
    Get-AzStorageBlobContent -Container $ContainerName -Blob $blob.Name -Destination "C:\scripts\$($blob.Name)" -Context $context -Force | Out-Null
}

Write-Host "Registering Scheduled Task to run infinitely in background..."
# Execution policy bypass and window style hidden so it runs invisibly.
$actionArgs = "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File C:\scripts\process_queue.ps1 -StorageAccountName $StorageAccountName -StorageAccountKey $StorageAccountKey -IntuneWinAppUtilPath C:\tools\IntuneWinAppUtil.exe"
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument $actionArgs -WorkingDirectory "C:\scripts"
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Days 0)
$principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName "PackemonWorker" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Starting the background worker task immediately..."
Start-ScheduledTask -TaskName "PackemonWorker"

Write-Host "Worker Node Provisioning Complete!"
