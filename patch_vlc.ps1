param(
    [string]$StorageAccountName = "apppkgdevstorage",
    [string]$StorageAccountKey = $env:AZURE_STORAGE_KEY
)
if (-not $StorageAccountKey) { throw "StorageAccountKey is required. Set \$env:AZURE_STORAGE_KEY or pass -StorageAccountKey." }
$context = New-AzStorageContext -StorageAccountName $StorageAccountName -StorageAccountKey $StorageAccountKey
Get-AzStorageBlobContent -Container "scripts" -Blob "VLC.ps1" -Destination "C:\Scripts\VLC.ps1" -Context $context -Force | Out-Null
Get-AzStorageBlobContent -Container "scripts" -Blob "vlc-media-player.ps1" -Destination "C:\Scripts\vlc-media-player.ps1" -Context $context -Force | Out-Null
Write-Host "Downloaded VLC packaging scripts to VM!"
