# ----------------------------------------------------------------------------------
# PACKEMON CUSTOM INSTALL TEMPLATE: Firefox ESR (PSADT ENABLED)
# Save this file as C:\Scripts\MozillaFirefox.ps1 on your Azure Worker VM
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

# Find the primary Firefox executable inside the extracted ZIP
$InstallerFile = Get-ChildItem -Path $PSADTFiles -Filter "*.exe" -Recurse | Select-Object -First 1

if (-not $InstallerFile) {
    throw "Executable installer not found in $PSADTFiles"
}

# Find the setup.ini file
$IniFile = Get-ChildItem -Path $PSADTFiles -Filter "setup.ini" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $IniFile) {
    $IniFile = Get-ChildItem -Path "C:\Temp\pkg\setup" -Filter "setup.ini" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
}

if (-not $IniFile) {
    # Auto-generate setup.ini if missing
    $iniPath = Join-Path $PSADTFiles "setup.ini"
    $iniContent = @"
[Setup]
SetupFile=$($InstallerFile.Name)
Arguments=/S
InstallType=EXE
AppName=$($AppInformation_ApplicationName)
Version=$($AppInformation_Version)
"@
    Set-Content -Path $iniPath -Value $iniContent -Force
    $IniFile = Get-Item $iniPath
}

Write-Host "Injecting logic into Deploy-Application.ps1..."

# We generate the PSADT commands as a block of text and inject it into the script
$installLogic = @"
        # 1. Install Firefox
        Execute-Process -Path `"`$dirFiles\$($InstallerFile.Name)`" -Parameters `"/INI=`"`$dirFiles\$($IniFile.Name)`"`" -WindowStyle 'Hidden'

        # 2. Copy the files
        `$InstallDirectoryPath = `"C:\Program Files (x86)\Mozilla Firefox ESR`"
        Copy-File -Path `"`$dirFiles\mozilla.cfg`" -Destination `"`$InstallDirectoryPath\mozilla.cfg`"
        Copy-File -Path `"`$dirFiles\Shareforce.vbs`" -Destination `"`$InstallDirectoryPath\Shareforce.vbs`"
        Copy-Folder -Path `"`$dirFiles\browser`" -Destination `"`$InstallDirectoryPath\browser`"
        Copy-Folder -Path `"`$dirFiles\defaults`" -Destination `"`$InstallDirectoryPath\defaults`"
        Copy-Folder -Path `"`$dirFiles\distribution`" -Destination `"`$InstallDirectoryPath\distribution`"

        # 3. Create Shortcut
        New-Shortcut -Path `"`$envPublic\Desktop\Mozilla Firefox ESR v$($AppInformation_Version).lnk`" -TargetPath `"`$InstallDirectoryPath\firefox.exe`" -IconLocation `"`$InstallDirectoryPath\firefox.exe`" -WorkingDirectory `"`$InstallDirectoryPath`"
"@

if (Test-Path $DeployAppScript) {
    $scriptContent = Get-Content $DeployAppScript
    $scriptContent = $scriptContent -replace '##INJECT_INSTALL_LOGIC_HERE##', $installLogic
    Set-Content -Path $DeployAppScript -Value $scriptContent
} else {
    New-Item -ItemType File -Force -Path $DeployAppScript | Out-Null
    Set-Content -Path $DeployAppScript -Value $installLogic
}

# ==================================================================================
# PACKAGE USING INTUNEWINAPPUTIL
# ==================================================================================

$IntuneWinAppUtil = "C:\tools\IntuneWinAppUtil.exe"

if (-not (Test-Path $IntuneWinAppUtil)) {
    throw "IntuneWinAppUtil not found at $IntuneWinAppUtil"
}

Write-Host "Creating .intunewin package..."

$setupFolder = $PSADTRoot
$setupExe = "Deploy-Application.exe"

if (-not (Test-Path "$PSADTRoot\Deploy-Application.exe")) {
    $setupFolder = $PSADTFiles
    $setupExe = $InstallerFile.Name
}

& $IntuneWinAppUtil `
    -c "$setupFolder" `
    -s "$setupExe" `
    -o "$OutputFolder" `
    -q

if ($LASTEXITCODE -ne 0) {
    throw "IntuneWinAppUtil packaging failed."
}

Write-Host "Packaging completed successfully. Output is ready for Intune!"
