# ==================================================================================
# DYNAMIC VARIABLES (Auto-injected by the Packemon Worker)
# ==================================================================================
$AppInformation_ApplicationName = ""
$AppInformation_Publisher       = ""
$AppInformation_Version         = ""
$AppInformation_Description     = ""
$AppInformation_OSTarget        = ""
$Requirements_Architecture      = ""
$InstallBehavior_InstallContext = ""
$InstallBehavior_InstallMode    = ""
$InstallBehavior_ShowProgress   = $false
$InstallBehavior_AllowDefer     = $false
$InstallBehavior_RestartHandling= ""
$InstallBehavior_TimeoutMin     = 60
$InstallBehavior_RetryCount     = 3
$InstallBehavior_RetryInterval  = 10
$InstallBehavior_StopProcesses  = ""
$Requirements_DiskSpaceCheckMB  = 0
$Requirements_RequireAdmin      = $true
$Requirements_MinimumOSBuild    = ""
$Requirements_MinimumCPU        = ""
$Requirements_MinimumRAM        = ""
$Scripts_EnablePreScript        = $false
$Scripts_FailIfPreScriptFails   = $true
$Scripts_EnablePostScript       = $false
$PostInstall_RestartService     = ""
$DetectionRules_RuleFormat      = ""
$DetectionRules_MSIProductCode  = ""
$DetectionRules_FileOrFolder    = ""
$DetectionRules_RegistryKey     = ""
$Dependencies_AppID             = ""
$Dependencies_AutoInstall       = $false
$Supersedence_AppID             = ""
$Supersedence_UninstallPrevious = $false
$ReturnCodes_SuccessCode        = 0
$ReturnCodes_RebootCode         = 3010

# ==================================================================================
# VLC INSTALL + REGISTRY CONFIGURATION
# ==================================================================================

# Variables auto-inherited from Azure VM Worker 
$SourceFolder = $setupDir
$OutputFolder = $outputDir

$InstallerFile = Get-ChildItem -Path $SourceFolder -Filter "*.msi" | Select-Object -First 1

if (-not $InstallerFile) {
    # If the installer is explicitly named differently by the web portal, we try to locate it
    if ($setupFile -and (Test-Path (Join-Path $SourceFolder $setupFile))) {
        $InstallerFile = Get-Item (Join-Path $SourceFolder $setupFile)
    } else {
        throw "MSI installer not found in $SourceFolder"
    }
}

Write-Host "Installing $($AppInformation_ApplicationName) version $($AppInformation_Version) silently..."

$installArgs = "/i `"$($InstallerFile.FullName)`" /qn /norestart"
$process = Start-Process -FilePath "msiexec.exe" -ArgumentList $installArgs -Wait -PassThru

if ($process.ExitCode -ne 0 -and $process.ExitCode -ne $ReturnCodes_RebootCode) {
    throw "VLC installation failed with exit code $($process.ExitCode)"
}

Write-Host "Applying registry configuration..."

# Read dynamic registry configs injected by the API (Array of {key, valueName, type, data})
if ($registryChanges) {
    foreach ($reg in $registryChanges) {
        $keyPath = $reg.key.Replace("HKLM\", "HKLM:\").Replace("HKCU\", "HKCU:\")

        if (-not (Test-Path $keyPath)) {
            New-Item -Path $keyPath -Force | Out-Null
        }

        # Convert simple types to PowerShell PropertyType
        $typeMap = @{
            "String" = "String"
            "DWord"  = "DWord"
            "QWord"  = "QWord"
        }
        $psType = $typeMap[$reg.type]
        if (-not $psType) { $psType = "String" }

        New-ItemProperty `
            -Path $keyPath `
            -Name $reg.valueName `
            -PropertyType $psType `
            -Value $reg.data `
            -Force | Out-Null
    }
}

Write-Host "Registry configuration applied successfully."

# ==================================================================================
# PACKAGE USING INTUNEWINAPPUTIL
# ==================================================================================

# Intune location is guaranteed by the Azure worker provisioning
$IntuneWinAppUtil = $IntuneWinAppUtilPath

if (-not (Test-Path $IntuneWinAppUtil)) {
    throw "IntuneWinAppUtil not found at $IntuneWinAppUtil"
}

Write-Host "Creating .intunewin package..."

& $IntuneWinAppUtil -c "$SourceFolder" -s "$($InstallerFile.Name)" -o "$OutputFolder" -q

if ($LASTEXITCODE -ne 0) {
    throw "IntuneWinAppUtil packaging failed."
}

Write-Host "Packaging completed successfully."

# (You can append your Connect-MsGraph code right here to instantly upload $OutputFolder\*.intunewin!)
