param(
    [string]$StorageAccountName = "apppkgdevstorage",
    [string]$StorageAccountKey = $env:AZURE_STORAGE_KEY
)
if (-not $StorageAccountKey) { throw "StorageAccountKey is required. Set \$env:AZURE_STORAGE_KEY or pass -StorageAccountKey." }
$context = New-AzStorageContext -StorageAccountName $StorageAccountName -StorageAccountKey $StorageAccountKey
Get-AzStorageBlobContent -Container "scripts" -Blob "process_queue.ps1" -Destination "C:\scripts\process_queue.ps1" -Context $context -Force | Out-Null
Get-AzStorageBlobContent -Container "scripts" -Blob "MozillaFirefox.ps1" -Destination "C:\scripts\MozillaFirefox.ps1" -Context $context -Force | Out-Null
Get-AzStorageBlobContent -Container "scripts" -Blob "mozilla-firefox.ps1" -Destination "C:\scripts\mozilla-firefox.ps1" -Context $context -Force | Out-Null
Get-AzStorageBlobContent -Container "scripts" -Blob "vlc-media-player.ps1" -Destination "C:\scripts\vlc-media-player.ps1" -Context $context -Force | Out-Null
Stop-ScheduledTask -TaskName "PackemonWorker" -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName "PackemonWorker"
Write-Host "Updated and restarted worker!"
