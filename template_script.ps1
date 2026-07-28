# ----------------------------------------------------------------------------------
# PACKEMON CUSTOM INSTALL TEMPLATE (PSADT INTEGRATED)
# Save this file as C:\Scripts\<AppName>.ps1 on your Azure Worker VM
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
### YOUR PACKAGING SCRIPT UNDER THIS ####

Write-Host "Configuring PSADT for $($AppInformation_ApplicationName) version $($AppInformation_Version) from $($AppInformation_Publisher)..."

$DeployAppScript = "$PSADTRoot\Deploy-Application.ps1"

# Search for any .msi file in the PSADT Files directory
$InstallerFile = Get-ChildItem -Path $PSADTFiles -Filter "*.msi" | Select-Object -First 1

if (-not $InstallerFile) {
    throw "MSI installer not found in $PSADTFiles"
}

Write-Host "Injecting logic into Deploy-Application.ps1..."

# Example of replacing a placeholder in the baseline Deploy-Application.ps1
# (You will need to ensure your PSADT_Base.zip has '##INJECT_INSTALL_LOGIC_HERE##' in the Installation phase)
$installCommand = "Execute-MSI -Action 'Install' -Path `"`$dirFiles\$($InstallerFile.Name)`" -Parameters `"/qn /norestart`""

$scriptContent = Get-Content $DeployAppScript
$scriptContent = $scriptContent -replace '##INJECT_INSTALL_LOGIC_HERE##', $installCommand

# You could also dynamically inject registry settings using $Configuration_registryValues if needed here
# For example, appending Set-RegistryKey commands to the script content

Set-Content -Path $DeployAppScript -Value $scriptContent

# ==================================================================================
# PACKAGE USING INTUNEWINAPPUTIL
# ==================================================================================

$IntuneWinAppUtil = "C:\tools\IntuneWinAppUtil.exe"

if (-not (Test-Path $IntuneWinAppUtil)) {
    throw "IntuneWinAppUtil not found at $IntuneWinAppUtil"
}

Write-Host "Creating .intunewin package..."

& $IntuneWinAppUtil `
    -c "$PSADTRoot" `
    -s "Deploy-Application.exe" `
    -o "$OutputFolder" `
    -q

if ($LASTEXITCODE -ne 0) {
    throw "IntuneWinAppUtil packaging failed."
}

Write-Host "Packaging completed successfully."

### END OF YOUR PACKAGING SCRIPT UNDER THIS ####
# ----------------------------------------------------------------------------------

# ==================================================================================
# 2. INTUNE UPLOAD LOGIC
# Note: Uploading and assigning to Intune is now handled automatically by the 
# central worker (process_queue.ps1) using the GraphApiHelper module.
# No script additions are required here.
# ==================================================================================
