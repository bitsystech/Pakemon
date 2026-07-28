# ----------------------------------------------------------------------------------
# PACKEMON CUSTOM INSTALL TEMPLATE: SAP GUI (PSADT ENABLED)
# Save this file as C:\Scripts\SAPGUI.ps1 on your Azure Worker VM
# ----------------------------------------------------------------------------------

# ==================================================================================
# DYNAMIC VARIABLES (Auto-injected by the Packemon Worker)
# You do not need to populate these; they will be populated automatically 
# upon execution based on the web UI form!
# ==================================================================================
# (Variables are automatically injected here by process_queue.ps1)
# You also have access to:
# $PSADTRoot   - Path to the extracted PSADT folder
# $PSADTFiles  - Path to the "Files" directory inside PSADT
# $OutputFolder - Path where the .intunewin package must be placed

# ==================================================================================
# 1. CONFIGURE PSADT AND PACKAGE
# ==================================================================================

Write-Host "Configuring PSADT for $($AppInformation_ApplicationName) version $($AppInformation_Version) from $($AppInformation_Publisher)..."

if (-not $PSADTRoot) { $PSADTRoot = "C:\Temp\pkg\PSADT" }
if (-not $PSADTFiles) { $PSADTFiles = "$PSADTRoot\Files" }
if (-not $OutputFolder) { $OutputFolder = "C:\Temp\pkg\output" }

$DeployAppScript = "$PSADTRoot\Deploy-Application.ps1"

# Find the SAP installer executable (often NwSapSetup.exe or similar)
$InstallerFile = Get-ChildItem -Path $PSADTFiles -Filter "*.exe" -Recurse | Select-Object -First 1

if (-not $InstallerFile) {
    throw "Executable installer not found in $PSADTFiles"
}

Write-Host "Injecting logic into Deploy-Application.ps1..."

# Injection for SAP GUI
# Note: SAP typically uses NwSapSetup.exe /Silent
$installCommand = "Execute-Process -Path `"`$dirFiles\$($InstallerFile.Name)`" -Parameters `"/Silent`" -WindowStyle 'Hidden'"

$scriptContent = Get-Content $DeployAppScript
$scriptContent = $scriptContent -replace '##INJECT_INSTALL_LOGIC_HERE##', $installCommand
Set-Content -Path $DeployAppScript -Value $scriptContent

# ==================================================================================
# PACKAGE USING INTUNEWINAPPUTIL
# ==================================================================================

$IntuneWinAppUtil = "C:\tools\IntuneWinAppUtil.exe"

if (-not (Test-Path $IntuneWinAppUtil)) {
    throw "IntuneWinAppUtil not found at $IntuneWinAppUtil"
}

Write-Host "Creating .intunewin package from PSADT root..."

& $IntuneWinAppUtil `
    -c "$PSADTRoot" `
    -s "Deploy-Application.exe" `
    -o "$OutputFolder" `
    -q

if ($LASTEXITCODE -ne 0) {
    throw "IntuneWinAppUtil packaging failed."
}

Write-Host "Packaging completed successfully. Output is ready for Intune!"

# (The automated worker script handles uploading the .intunewin to Blob Storage natively!)
