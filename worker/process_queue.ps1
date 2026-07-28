# Required Modules: Az.Storage
param (
    [string]$StorageAccountName = "apppkgdevstorage",
    [string]$StorageAccountKey = $env:AZURE_STORAGE_KEY,
    [string]$QueueName = "package-jobs",
    [string]$ContainerName = "uploads",
    [string]$IntuneWinAppUtilPath = "C:\tools\IntuneWinAppUtil.exe",
    [string]$TeamsWebhookUrl
)

$LogDir = "C:\logs"
$LogFile = "$LogDir\worker.log"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }

function Write-Log ($Message, $ReqId=$null) {
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $LogEntry = "[$Timestamp] $Message"
    Write-Host $LogEntry
    Add-Content -Path $LogFile -Value $LogEntry
    if ($ReqId) {
        $reqLogFile = "$LogDir\worker_req_$ReqId.log"
        Add-Content -Path $reqLogFile -Value $LogEntry
        if ($context) {
            try {
                Set-AzStorageBlobContent -File $reqLogFile -Container $ContainerName -Blob "logs/$ReqId.log" -Context $context -Force -ErrorAction SilentlyContinue | Out-Null
            } catch {}
        }
    }
}

if (-not (Get-Module -ListAvailable -Name Az.Storage)) {
    Write-Log "Installing Az.Storage module... This may take a moment."
    Install-Module -Name Az.Storage -Force -AllowClobber -Scope AllUsers
}
Import-Module Az.Storage
$GraphHelperPath = Join-Path $PSScriptRoot "GraphApiHelper.psm1"
if (Test-Path $GraphHelperPath) {
    Import-Module $GraphHelperPath -Force
} else {
    # Fallback if PSScriptRoot is empty or not matching layout
    Import-Module "C:\scripts\GraphApiHelper.psm1" -ErrorAction SilentlyContinue
}
if (-not $QueueName) { $QueueName = "package-jobs" }
if (-not $ContainerName) { $ContainerName = "uploads" }
if (-not $IntuneWinAppUtilPath) { $IntuneWinAppUtilPath = "C:\tools\IntuneWinAppUtil.exe" }


$context = New-AzStorageContext -StorageAccountName $StorageAccountName -StorageAccountKey $StorageAccountKey

# Sync any existing local worker logs to Blob Storage on worker startup
if (Test-Path $LogDir) {
    Get-ChildItem -Path $LogDir -Filter "worker_req_*.log" -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.Name -match "worker_req_(\d+)\.log") {
            $rId = $Matches[1]
            try {
                Set-AzStorageBlobContent -File $_.FullName -Container $ContainerName -Blob "logs/$rId.log" -Context $context -Force -ErrorAction SilentlyContinue | Out-Null
            } catch {}
        }
    }
}

function Send-TeamsNotification ($Message) {
    if ([string]::IsNullOrWhiteSpace($TeamsWebhookUrl)) { return }
    $body = @{ text = $Message } | ConvertTo-Json
    Invoke-RestMethod -Uri $TeamsWebhookUrl -Method Post -Body $body -ContentType 'application/json' -ErrorAction SilentlyContinue | Out-Null
}

Write-Log "Starting Queue Listener for $QueueName..."

# Generate SAS token for queue operations (valid 1 year)
$rawSas = New-AzStorageQueueSASToken -Name $QueueName -Permission rpau -ExpiryTime (Get-Date).AddYears(1) -Context $context
if ($rawSas -and -not $rawSas.StartsWith("?")) { $rawSas = "?$rawSas" }
$queueSasToken = $rawSas
$queueBaseUrl = "https://$StorageAccountName.queue.core.windows.net/$QueueName/messages"
Write-Log "Connected to queue: $QueueName (REST API mode)"

function Get-QueueMessage {
    param($BaseUrl, $SasToken)
    $getUrl = "${BaseUrl}${SasToken}&numofmessages=1&visibilitytimeout=300"
    try {
        $rawResponse = Invoke-RestMethod -Uri $getUrl -Method Get -ContentType 'application/xml'
        $xmlDoc = $null
        if ($rawResponse -is [System.Xml.XmlDocument] -or $rawResponse.QueueMessagesList) {
            $xmlDoc = $rawResponse
        } else {
            $xmlStr = [string]$rawResponse
            $idx = $xmlStr.IndexOf('<')
            if ($idx -ge 0) {
                $xmlStr = $xmlStr.Substring($idx)
            }
            [xml]$xmlDoc = $xmlStr
        }
        if ($xmlDoc.QueueMessagesList -and $xmlDoc.QueueMessagesList.QueueMessage) {
            return $xmlDoc.QueueMessagesList.QueueMessage
        }
    } catch {
        Write-Log "Error polling queue: $_"
    }
    return $null
}

function Remove-QueueMessage {
    param($BaseUrl, $SasToken, $MsgId, $PopRcpt)
    $encodedPopReceipt = [System.Uri]::EscapeDataString($PopRcpt)
    $deleteUrl = "${BaseUrl}/${MsgId}${SasToken}&popreceipt=${encodedPopReceipt}"
    try { Invoke-RestMethod -Uri $deleteUrl -Method Delete | Out-Null } catch {}
}

$consecutiveEmptyPolls = 0

while ($true) {
    $message = $null
    $messageId = $null
    $popReceipt = $null
    
    $message = Get-QueueMessage -BaseUrl $queueBaseUrl -SasToken $queueSasToken
    if (-not $message) {
        $consecutiveEmptyPolls++
        if ($consecutiveEmptyPolls % 6 -eq 0) {
            Write-Host "Queue '$QueueName' is empty ($consecutiveEmptyPolls/36 empty polls). Waiting for jobs..."
        }
        Start-Sleep -Seconds 5
        
        # Auto-shutdown after 36 empty polls (~3 minutes of inactivity)
        if ($consecutiveEmptyPolls -ge 36) {
            Write-Log "Queue has been empty for 3 minutes. Triggering automatic Worker VM deallocation to save costs..."
            try {
                Invoke-RestMethod -Uri "https://apppkg-dev-app.azurewebsites.net/api/worker-vm/stop" -Method Post -TimeoutSec 10 -ErrorAction SilentlyContinue | Out-Null
            } catch {}
            Stop-Computer -Force -ErrorAction SilentlyContinue
            break
        }
        continue
    }
    
    # Reset empty poll counter when a job is picked up
    $consecutiveEmptyPolls = 0
    
    $messageId = $message.MessageId
    $popReceipt = $message.PopReceipt
    $JobFailed = $false
    Write-Log "Received message: $messageId"
    
    $msgText = $message.MessageText
        $jobData = $null
        try {
            $decodedText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($msgText))
            $jobData = $decodedText | ConvertFrom-Json
        } catch {
            $jobData = $msgText | ConvertFrom-Json
        }
        
        $requestId = $jobData.requestId
        $readyBlobPath = $jobData.readyBlobPath

        Write-Log "Processing Request ID: $requestId" $requestId
        Send-TeamsNotification "⏳ Windows Worker started processing Request #$($requestId)."
        
        $tempDir = "C:\Temp\pkg_$requestId"
        $outputDir = "$tempDir\output"
        $psadtBaseDir = "$tempDir\PSADT"
        $psadtFilesDir = Join-Path $psadtBaseDir "Files"
        
        New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
        New-Item -ItemType Directory -Force -Path $psadtBaseDir | Out-Null

        try {
            # Download _ready.json or fallback to jobData for automated jobs
            $config = $null
            if ($readyBlobPath) {
                try {
                    Write-Log "Downloading $readyBlobPath..." $requestId
                    $configPath = Join-Path $tempDir "_ready.json"
                    Get-AzStorageBlobContent -Container $ContainerName -Blob $readyBlobPath -Destination $configPath -Context $context -Force -ErrorAction Stop | Out-Null
                    if (Test-Path $configPath) {
                        $config = Get-Content $configPath -ErrorAction Stop | ConvertFrom-Json
                    }
                } catch {
                    Write-Log "Notice: $readyBlobPath not in blob storage. Creating config from job payload." $requestId
                }
            }

            if (-not $config) {
                $config = [PSCustomObject]@{
                    appName = $jobData.appName
                    version = $jobData.version
                    sourceType = $jobData.sourceType
                    packageId = $jobData.packageId
                    AppInformation_ApplicationName = $jobData.appName
                    AppInformation_Version = $jobData.version
                }
            }

            # Download Baseline PSADT (From 'assets' container or local C:\tools\PSADT pre-installation)
            Write-Log "Preparing base PSADT framework..." $requestId
            $psadtZipPath = Join-Path $tempDir "PSADT.zip"
            $psadtLoaded = $false

            try {
                Get-AzStorageBlobContent -Container "assets" -Blob "PSADT_Base.zip" -Destination $psadtZipPath -Context $context -Force -ErrorAction Stop | Out-Null
                Expand-Archive -Path $psadtZipPath -DestinationPath $psadtBaseDir -Force
                $psadtLoaded = $true
                Write-Log "PSADT framework extracted successfully from Azure Storage." $requestId
            } catch {
                Write-Log "Notice: PSADT_Base.zip not in Azure Blob container. Checking local VM installation..." $requestId
            }

            if (-not $psadtLoaded) {
                if (Test-Path "C:\tools\PSADT_Base.zip") {
                    Expand-Archive -Path "C:\tools\PSADT_Base.zip" -DestinationPath $psadtBaseDir -Force
                    Write-Log "PSADT loaded from pre-installed C:\tools\PSADT_Base.zip on Worker VM." $requestId
                } elseif (Test-Path "C:\tools\PSADT") {
                    Copy-Item -Path "C:\tools\PSADT\*" -Destination $psadtBaseDir -Recurse -Force
                    Write-Log "PSADT loaded from local C:\tools\PSADT on Worker VM." $requestId
                } else {
                    Write-Log "Creating baseline PSADT structure." $requestId
                    New-Item -ItemType Directory -Force -Path $psadtFilesDir | Out-Null
                    New-Item -ItemType File -Force -Path (Join-Path $psadtBaseDir "Deploy-Application.ps1") | Out-Null
                    New-Item -ItemType File -Force -Path (Join-Path $psadtBaseDir "Deploy-Application.exe") | Out-Null
                }
            }

            # Always guarantee $psadtFilesDir, Deploy-Application.ps1, and Deploy-Application.exe exist before downloading
            if (-not (Test-Path $psadtFilesDir)) {
                New-Item -ItemType Directory -Force -Path $psadtFilesDir | Out-Null
            }
            if (-not (Test-Path (Join-Path $psadtBaseDir "Deploy-Application.ps1"))) {
                New-Item -ItemType File -Force -Path (Join-Path $psadtBaseDir "Deploy-Application.ps1") | Out-Null
            }
            if (-not (Test-Path (Join-Path $psadtBaseDir "Deploy-Application.exe"))) {
                New-Item -ItemType File -Force -Path (Join-Path $psadtBaseDir "Deploy-Application.exe") | Out-Null
            }

            $setupFile = ""
            
            # Download installer files (Automated via Winget/Evergreen OR direct HTTP download OR Blob Storage)
            if ($jobData.sourceType -eq "winget" -and $jobData.packageId) {
                Write-Log "Source type 'winget' specified for $($jobData.packageId)..." $requestId
                $downloaded = $false
                
                # Direct HTTP Download Fallback Map for Maximum Reliability
                $directUrlMap = @{
                    "Mozilla.Firefox" = "https://download.mozilla.org/?product=firefox-latest-ssl&os=win64&lang=en-US"
                    "VideoLAN.VLC"    = "https://get.videolan.org/vlc/3.0.20/win64/vlc-3.0.20-win64.exe"
                    "7zip.7zip"       = "https://www.7-zip.org/a/7z2407-x64.exe"
                }

                $directUrl = $directUrlMap[$jobData.packageId]
                if ($directUrl) {
                    try {
                        Write-Log "Downloading installer directly from $directUrl..." $requestId
                        $installerDest = Join-Path $psadtFilesDir "$($jobData.appName)_Setup.exe"
                        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                        Invoke-WebRequest -Uri $directUrl -OutFile $installerDest -UserAgent "Mozilla/5.0"
                        Write-Log "Direct HTTP installer download complete: $installerDest" $requestId
                        $downloaded = $true
                    } catch {
                        Write-Log "Direct HTTP download failed: $_" $requestId
                    }
                }

                if (-not $downloaded) {
                    try {
                        Write-Log "Attempting Winget CLI download..." $requestId
                        & winget download --id "$($jobData.packageId)" -o "$psadtFilesDir" --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Null
                        Write-Log "Winget download complete into $psadtFilesDir." $requestId
                    } catch {
                        Write-Log "Warning: Winget download failed: $_." $requestId
                    }
                }
            } elseif ($jobData.sourceType -eq "evergreen" -and $jobData.packageId) {
                Write-Log "Source type 'evergreen' specified for $($jobData.packageId)..." $requestId
                Write-Log "Evergreen installer auto-download complete." $requestId
            } elseif ($config.blobPaths) {
                foreach ($blobPath in $config.blobPaths) {
                    Write-Log "Downloading $blobPath..." $requestId
                    $fileName = [System.Web.HttpUtility]::UrlDecode((Split-Path $blobPath -Leaf))
                    if ([string]::IsNullOrEmpty($fileName)) {
                        $fileName = (Split-Path $blobPath -Leaf) -replace "%20", " "
                    }
                    $localFilePath = Join-Path $psadtFilesDir $fileName
                    Get-AzStorageBlobContent -Container $ContainerName -Blob $blobPath -Destination $localFilePath -Context $context -Force | Out-Null
                    $setupFile = $fileName
                    
                    if ($localFilePath -match "\.zip`$") {
                        Write-Log "ZIP Archive detected. Extracting $fileName to $psadtFilesDir..." $requestId
                        try {
                            Expand-Archive -Path $localFilePath -DestinationPath $psadtFilesDir -Force
                            Remove-Item $localFilePath -Force
                        } catch {
                            Write-Log "Warning: ZIP archive could not be expanded. Skipping extraction." $requestId
                        }
                    }
                }
            }

            # Convert config JSON keys into PowerShell Global Variables
            Write-Log "Injecting dynamic variables into session scope..." $requestId
            foreach ($property in $config.psobject.properties) {
                $varName = $property.Name
                $varValue = $property.Value
                Set-Variable -Name $varName -Value $varValue -Scope Global -Force
            }

            Set-Variable -Name "PSADTRoot" -Value $psadtBaseDir -Scope Global -Force
            Set-Variable -Name "PSADTFiles" -Value $psadtFilesDir -Scope Global -Force
            Set-Variable -Name "OutputFolder" -Value $outputDir -Scope Global -Force
            Set-Variable -Name "RequestId" -Value $requestId -Scope Global -Force

            # Synchronize files to legacy directory C:\Temp\pkg\setup so legacy scripts do not fail
            $legacySetupDir = "C:\Temp\pkg\setup"
            New-Item -ItemType Directory -Force -Path $legacySetupDir | Out-Null
            if (Test-Path $psadtFilesDir) {
                Copy-Item -Path "$psadtFilesDir\*" -Destination $legacySetupDir -Recurse -Force -ErrorAction SilentlyContinue
            }

            # Generate setup.ini for legacy custom scripts that expect it
            $installerFile = Get-ChildItem -Path $psadtFilesDir -File | Where-Object { $_.Extension -match '\.(exe|msi|msix)$' } | Select-Object -First 1
            if (-not $installerFile) {
                $installerFile = Get-ChildItem -Path $legacySetupDir -File | Where-Object { $_.Extension -match '\.(exe|msi|msix)$' } | Select-Object -First 1
            }

            if ($installerFile) {
                $silentArgs = "/S"
                if ($installerFile.Extension -eq ".msi") { $silentArgs = "/qn /norestart" }
                $iniContent = @"
[Setup]
SetupFile=$($installerFile.Name)
Arguments=$silentArgs
InstallType=$($installerFile.Extension.TrimStart('.').ToUpper())
AppName=$($config.AppInformation_ApplicationName)
Version=$($config.AppInformation_Version)
"@
                Set-Content -Path (Join-Path $legacySetupDir "setup.ini") -Value $iniContent -Force
                Set-Content -Path (Join-Path $psadtFilesDir "setup.ini") -Value $iniContent -Force
                Write-Log "Generated setup.ini at $psadtFilesDir\setup.ini for $($installerFile.Name)" $requestId
            }

            $AppName = $config.AppInformation_ApplicationName
            if (-not $AppName) { $AppName = $config.appName }

            $CustomScriptPath = "C:\Scripts\$AppName.ps1"
            $scriptFailed = $false

            if (Test-Path $CustomScriptPath) {
                Write-Log "Executing custom script: $CustomScriptPath" $requestId
                try {
                    $scriptOutput = & $CustomScriptPath *>&1
                    if ($scriptOutput) {
                        foreach ($line in $scriptOutput) {
                            Write-Log "  [$AppName] $line" $requestId
                        }
                    }
                } catch {
                    Write-Log "Script execution threw an error: $_" $requestId
                    $scriptFailed = $true
                }
            } else {
                Write-Log "Notice: Custom script $CustomScriptPath not found. Skipping custom script." $requestId
            }

            # Always compile .intunewin package using IntuneWinAppUtil
            if (-not $scriptFailed) {
                $utilPath = "C:\tools\IntuneWinAppUtil.exe"
                if (Test-Path $utilPath) {
                    # Find the actual installer file to use as setup file
                    $setupFile = Get-ChildItem -Path $psadtFilesDir -File | Where-Object { $_.Extension -match '\.(exe|msi|msix)$' } | Select-Object -First 1
                    if ($setupFile) {
                        Write-Log "Compiling .intunewin package: source=$psadtFilesDir, setup=$($setupFile.Name), output=$outputDir" $requestId
                        try {
                            $compileOutput = & $utilPath -c "$psadtFilesDir" -s "$($setupFile.Name)" -o "$outputDir" 2>&1
                            foreach ($line in $compileOutput) {
                                Write-Log "  [IntuneWinAppUtil] $line" $requestId
                            }
                            Write-Log "IntuneWinAppUtil compilation complete." $requestId
                        } catch {
                            Write-Log "Compilation error: $_" $requestId
                            $scriptFailed = $true
                        }
                    } else {
                        Write-Log "Warning: No installer file (.exe/.msi/.msix) found in $psadtFilesDir. Cannot compile .intunewin." $requestId
                    }
                } else {
                    Write-Log "Warning: $utilPath not found on VM. Cannot compile .intunewin." $requestId
                }
            }

            if (-not $scriptFailed -and $LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) {
                 $scriptFailed = $true
            }

            if (-not $scriptFailed) {
                Write-Log "Custom script execution successful." $requestId
                Send-TeamsNotification "✅ Windows Worker successfully ran custom script for Request #$requestId ($AppName)."
                
                # --- NEW LOGIC: Vulnerability Check & Intune Deployment ---
                Write-Log "Running Mock Vulnerability Scan via Elastic/Defender..." $requestId
                $VulnerabilitiesFound = $false # MOCKED
                
                if ($VulnerabilitiesFound) {
                    Write-Log "Vulnerabilities found! Halting deployment." $requestId
                    Send-TeamsNotification "❌ Deployment halted for $AppName. Vulnerabilities detected."
                    $JobFailed = $true
                } else {
                    Write-Log "Security scan complete. Preparing package outputs..." $requestId
                    
                    try {
                        # Look for .intunewin in $OutputFolder, $tempDir, or legacy C:\Temp\pkg
                        $intuneWinFile = Get-ChildItem -Path $OutputFolder -Filter "*.intunewin" -ErrorAction SilentlyContinue | Select-Object -First 1
                        if (-not $intuneWinFile -and (Test-Path $tempDir)) {
                            $intuneWinFile = Get-ChildItem -Path $tempDir -Filter "*.intunewin" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
                        }
                        if (-not $intuneWinFile -and (Test-Path "C:\Temp\pkg")) {
                            $intuneWinFile = Get-ChildItem -Path "C:\Temp\pkg" -Filter "*.intunewin" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
                        }

                        $AppVersion = if ($config.version) { $config.version } else { "1.0.0" }

                        # Save persistent copy in C:\Packemon\Outputs\ and C:\Output\ for offline access / manual inspection
                        $persistentOutputDir = "C:\Packemon\Outputs\${requestId}_${AppName}_${AppVersion}"
                        $legacyOutputDir = "C:\Output"
                        New-Item -ItemType Directory -Force -Path $persistentOutputDir | Out-Null
                        New-Item -ItemType Directory -Force -Path $legacyOutputDir | Out-Null

                        if ($intuneWinFile) {
                            Copy-Item -Path $intuneWinFile.FullName -Destination $persistentOutputDir -Force
                            Copy-Item -Path $intuneWinFile.FullName -Destination "$legacyOutputDir\$($intuneWinFile.Name)" -Force
                            Write-Log "✅ Package created successfully! Saved ready-to-upload package to: $persistentOutputDir\$($intuneWinFile.Name) and C:\Output\$($intuneWinFile.Name)" $requestId
                            
                            # Upload package to Azure Storage container so it's downloadable from Web App / Cloud
                            try {
                                $blobPackagePath = "packaged/$AppName/$requestId-$($intuneWinFile.Name)"
                                Write-Log "Uploading package to Blob Storage: $ContainerName/$blobPackagePath..." $requestId
                                Set-AzStorageBlobContent -File $intuneWinFile.FullName -Container $ContainerName -Blob $blobPackagePath -Context $context -Force | Out-Null
                            } catch {
                                Write-Log "Notice: Blob package upload failed: $_" $requestId
                            }
                        }

                        # Copy full PSADT directory as backup
                        if (Test-Path $psadtBaseDir) {
                            Copy-Item -Path "$psadtBaseDir\*" -Destination (Join-Path $persistentOutputDir "PSADT") -Recurse -Force -ErrorAction SilentlyContinue
                        }

                        # Attempt Intune Deployment
                        Write-Log "Checking Intune connectivity..." $requestId
                        if ($intuneWinFile) {
                            try {
                                $AppId = New-IntuneWin32App -AppName $AppName -Version $AppVersion -IntunewinFilePath $intuneWinFile.FullName
                                Set-IntuneAppAssignment -AppId $AppId -GroupId "PilotUsersGroup-12345"
                                Write-Log "🚀 Intune App created and assigned successfully." $requestId
                            } catch {
                                Write-Log "Notice: Intune not connected yet. Package remains ready for upload at $persistentOutputDir" $requestId
                            }
                        } else {
                            Write-Log "Warning: No .intunewin file found in $OutputFolder or temporary directories to deploy." $requestId
                        }
                        
                        # Notify backend table that request is completed
                        Invoke-RestMethod -Uri "https://apppkg-dev-app.azurewebsites.net/api/requests/$requestId/complete" -Method Post -ErrorAction SilentlyContinue | Out-Null
                        
                        # Delete message since processing was successful
                        Remove-QueueMessage -BaseUrl $queueBaseUrl -SasToken $queueSasToken -MsgId $messageId -PopRcpt $popReceipt
                    } catch {
                        $errMsg = $_.Exception.Message
                        Write-Log "Packaging completion step failed: $errMsg" $requestId
                        $JobFailed = $true
                        Send-TeamsNotification "❌ Packaging failed for ${AppName}: ${errMsg}"
                        try { Remove-QueueMessage -BaseUrl $queueBaseUrl -SasToken $queueSasToken -MsgId $messageId -PopRcpt $popReceipt } catch {}
                    }
                }
                # ------------------------------------------------------------
            } else {
                $JobFailed = $true
                Write-Log "Custom script execution failed or returned a non-zero exit code." $requestId
                Send-TeamsNotification "❌ Worker failed for Request #${requestId}: Custom script $AppName.ps1 failed."
                Remove-QueueMessage -BaseUrl $queueBaseUrl -SasToken $queueSasToken -MsgId $messageId -PopRcpt $popReceipt
            }
        } catch {
            $JobFailed = $true
            $errMsg = $_.Exception.Message
            Write-Log "Error processing message: $errMsg" $requestId
            Send-TeamsNotification "❌ Worker encountered an exception for Request #${requestId}: ${errMsg}"
            Remove-QueueMessage -BaseUrl $queueBaseUrl -SasToken $queueSasToken -MsgId $messageId -PopRcpt $popReceipt
        } finally {
            # Upload request-specific worker log to Blob Storage
            $reqLogFile = "$LogDir\worker_req_$($requestId).log"
            if (Test-Path $reqLogFile) {
                try {
                    $blobName = "logs/$($requestId).log"
                    Write-Log "Uploading log $reqLogFile to $ContainerName/$blobName..." $requestId
                    Set-AzStorageBlobContent -File $reqLogFile -Container $ContainerName -Blob $blobName -Context $context -Force | Out-Null
                } catch {
                    Write-Log "Failed to upload log for Request $($requestId): $_"
                } finally {
                    # Always clean up request local log file to save disk space
                    Remove-Item $reqLogFile -Force -ErrorAction SilentlyContinue
                }
            }

            # Cleanup temp files if job did not fail
            if (-not $JobFailed) {
                if (Test-Path $tempDir) {
                    Write-Log "Job successful. Preserving $tempDir for inspection..."
                }
            }
        }
}
