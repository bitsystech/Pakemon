param(
    [string]$StorageAccountName = "apppkgdevstorage",
    [string]$StorageAccountKey = $env:AZURE_STORAGE_KEY,
    [string]$QueueName = "package-jobs"
)
if (-not $StorageAccountKey) { throw "StorageAccountKey is required. Set \$env:AZURE_STORAGE_KEY or pass -StorageAccountKey." }

Write-Host "Re-triggering Request ID 19 (VLC) via Queue Injection..."

If (-not (Get-Module -Name Az.Storage -ListAvailable)) {
    Install-Module Az.Storage -Force -AllowClobber -Scope CurrentUser
}
Import-Module Az.Storage

$context = New-AzStorageContext -StorageAccountName $StorageAccountName -StorageAccountKey $StorageAccountKey

# Recreate the exact JSON payload the Node backend would send after approval
$messageContent = @{
    requestId = 19
    readyBlobPath = "vlc-media-player/3.0.21/_ready.json"
} | ConvertTo-Json -Compress

# Send it directly to the Queue to trigger the background worker!
$queue = Get-AzStorageQueue -Name $QueueName -Context $context
$queueMessage = New-Object Microsoft.Azure.Storage.Queue.CloudQueueMessage([System.Text.Encoding]::UTF8.GetBytes($messageContent))
$queue.QueueClient.AddMessage($queueMessage)

Write-Host "Success! The Azure VM worker has now received the injection and will start processing VLC."
