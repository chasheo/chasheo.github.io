param([string]$ConfigPath = (Join-Path $PSScriptRoot '.local.json'))
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$dataDir = if ($config.data_dir) { $config.data_dir } else { Join-Path $env:LOCALAPPDATA 'chasheo-worlds' }
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$keyId = (Read-Host 'Personal Cloudflare TURN key ID').Trim()
if ($keyId -notmatch '^[A-Za-z0-9_-]{16,128}$') { throw 'Invalid TURN key ID.' }
$secureToken = Read-Host 'Personal TURN API token (hidden input)' -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
$secretPath = Join-Path $dataDir 'cloudflare-turn.private.json'
try {
    $apiToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    if ([string]::IsNullOrWhiteSpace($apiToken)) { throw 'TURN API token is empty.' }
    # Create an empty restricted file before writing the permanent secret.
    if (-not (Test-Path -LiteralPath $secretPath)) { New-Item -ItemType File -Path $secretPath | Out-Null }
    $acl = Get-Acl -LiteralPath $secretPath
    $acl.SetAccessRuleProtection($true, $false)
    $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemAccount = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner, 'FullControl', 'Allow'))
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemAccount, 'FullControl', 'Allow'))
    Set-Acl -LiteralPath $secretPath -AclObject $acl
    @{ turn_key_id=$keyId; api_token=$apiToken.Trim() } | ConvertTo-Json | Set-Content -LiteralPath $secretPath -Encoding utf8
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    Remove-Variable apiToken -ErrorAction SilentlyContinue
    $secureToken.Dispose()
}
$config | Add-Member -NotePropertyName cloudflare_turn_file -NotePropertyValue $secretPath -Force
if ($config.PSObject.Properties['ice_config_file']) { $config.ice_config_file = '' }
$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ConfigPath -Encoding utf8
Write-Output 'Personal TURN configuration saved privately. Restart the idle demo host to apply it.'
Write-Output 'Keys stay on this computer. Each game requests separate credentials valid for 24 hours.'
