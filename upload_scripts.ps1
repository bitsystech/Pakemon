param(
    [string]$StorageAccountName = "apppkgdevstorage",
    [string]$StorageAccountKey = $env:AZURE_STORAGE_KEY
)
if (-not $StorageAccountKey) { throw "StorageAccountKey is required. Set \$env:AZURE_STORAGE_KEY or pass -StorageAccountKey." }
$context = New-AzStorageContext -StorageAccountName $StorageAccountName -StorageAccountKey $StorageAccountKey

Set-AzStorageBlobContent -File "worker/process_queue.ps1" -Container "scripts" -Blob "process_queue.ps1" -Context $context -Force
Write-Host "Uploaded updated process_queue.ps1 to Azure Blob Storage 'scripts' container!"
