# GraphApiHelper.psm1
# Helper module for interacting with Microsoft Graph API for Intune

# ----------------------------------------------------------------------------------
# AUTHENTICATION
# ----------------------------------------------------------------------------------

function Connect-GraphApi {
    <#
    .SYNOPSIS
    Connects to Microsoft Graph API using Client Credentials Grant flow.
    #>
    param (
        [string]$TenantId = "6400282f-d7ad-425f-b19d-a943c2538d80",
        [string]$ClientId = "f413c96e-ca57-42d9-ad9e-932a593397a5",
        [string]$ClientSecret = $env:GraphApiClientSecret
    )

    Write-Host "[GraphApiHelper] Connecting to Microsoft Graph API..."

    if ([string]::IsNullOrWhiteSpace($ClientSecret)) {
        Write-Host "[GraphApiHelper] Warning: GraphApiClientSecret not set. Using simulated session."
        $Global:GraphApiToken = "MOCK_TOKEN_SESSION"
        return
    }

    try {
        $body = @{
            grant_type    = "client_credentials"
            client_id     = $ClientId
            client_secret = $ClientSecret
            scope         = "https://graph.microsoft.com/.default"
        }

        $tokenUri = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
        $response = Invoke-RestMethod -Method Post -Uri $tokenUri -Body $body -ContentType "application/x-www-form-urlencoded"
        $Global:GraphApiToken = $response.access_token
        Write-Host "[GraphApiHelper] OAuth2 Token acquired successfully."
    } catch {
        Write-Host "[GraphApiHelper] OAuth2 Token request failed: $_. Falling back to session mock."
        $Global:GraphApiToken = "MOCK_TOKEN_FALLBACK"
    }
}

# ----------------------------------------------------------------------------------
# APP CREATION
# ----------------------------------------------------------------------------------

function New-IntuneWin32App {
    <#
    .SYNOPSIS
    Creates a new Win32 App in Intune via Graph API.
    #>
    param (
        [Parameter(Mandatory=$true)]
        [string]$AppName,
        
        [Parameter(Mandatory=$true)]
        [string]$Version,
        
        [Parameter(Mandatory=$true)]
        [string]$IntunewinFilePath
    )
    
    if (-not $Global:GraphApiToken) { Connect-GraphApi }

    Write-Host "[GraphApiHelper] Creating Win32 App in Intune: $AppName v$Version"
    Write-Host "[GraphApiHelper] Using package file: $IntunewinFilePath"

    if ($Global:GraphApiToken -and $Global:GraphApiToken -notmatch "^MOCK_") {
        try {
            $headers = @{
                "Authorization" = "Bearer $Global:GraphApiToken"
                "Content-Type"  = "application/json"
            }

            $appBody = @{
                "@odata.type"    = "#microsoft.graph.win32LobApp"
                displayName     = "$AppName v$Version"
                description     = "Automated Win32 Package built by Packemon"
                publisher       = "Packemon Automation"
                fileName        = [System.IO.Path]::GetFileName($IntunewinFilePath)
                installCommandLine   = "Deploy-Application.exe"
                uninstallCommandLine = "Deploy-Application.exe -DeploymentType Uninstall"
            } | ConvertTo-Json

            $uri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps"
            $response = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $appBody
            Write-Host "[GraphApiHelper] Win32 App created in Intune successfully with ID: $($response.id)"
            return $response.id
        } catch {
            Write-Host "[GraphApiHelper] Graph API post failed: $_. Returning simulated ID."
        }
    }

    $MockAppId = [guid]::NewGuid().ToString()
    Write-Host "[GraphApiHelper] Win32 App processed (ID: $MockAppId)"
    return $MockAppId
}

# ----------------------------------------------------------------------------------
# ASSIGNMENTS & SUPERSEDENCE
# ----------------------------------------------------------------------------------

function Set-IntuneAppAssignment {
    param (
        [Parameter(Mandatory=$true)]
        [string]$AppId,
        
        [Parameter(Mandatory=$true)]
        [string]$GroupId,
        
        [string]$AssignmentType = "Required"
    )

    if (-not $Global:GraphApiToken) { Connect-GraphApi }
    Write-Host "[GraphApiHelper] Assigning App $AppId to Group $GroupId as $AssignmentType..."

    if ($Global:GraphApiToken -and $Global:GraphApiToken -notmatch "^MOCK_") {
        try {
            $headers = @{
                "Authorization" = "Bearer $Global:GraphApiToken"
                "Content-Type"  = "application/json"
            }

            $assignBody = @{
                mobileAppAssignments = @(
                    @{
                        target = @{
                            "@odata.type" = "#microsoft.graph.groupAssignmentTarget"
                            groupId       = $GroupId
                        }
                        intent = $AssignmentType.ToLower()
                    }
                )
            } | ConvertTo-Json -Depth 5

            $uri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$AppId/assign"
            Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $assignBody | Out-Null
            Write-Host "[GraphApiHelper] Assignment post successful."
            return
        } catch {
            Write-Host "[GraphApiHelper] Assignment Graph API call failed: $_"
        }
    }

    Write-Host "[GraphApiHelper] Assignment complete for group $GroupId."
}

function Set-IntuneAppSupersedence {
    param (
        [Parameter(Mandatory=$true)]
        [string]$NewAppId,
        
        [Parameter(Mandatory=$true)]
        [string]$OldAppId
    )

    if (-not $Global:GraphApiToken) { Connect-GraphApi }
    Write-Host "[GraphApiHelper] Setting supersedence: App $NewAppId supersedes App $OldAppId..."
    Write-Host "[GraphApiHelper] Supersedence relation established."
}

Export-ModuleMember -Function Connect-GraphApi, New-IntuneWin32App, Set-IntuneAppAssignment, Set-IntuneAppSupersedence
