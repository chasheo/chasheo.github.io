param(
    [Parameter(Mandatory=$true)][string]$PublicUrl,
    [switch]$Publish,
    [string]$ConfigPath = (Join-Path $PSScriptRoot '.local.json')
)
$ErrorActionPreference = 'Stop'
$address = [uri]$PublicUrl
if ($address.Scheme -ne 'https' -or $address.UserInfo -or $address.Query -or $address.Fragment -or $address.AbsolutePath -ne '/') {
    throw 'Use a public HTTPS origin without a path, credentials, query or fragment.'
}
$PublicUrl = $address.GetLeftPart([UriPartial]::Authority)
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$localHealth = $null
try { $localHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:18790/api/health' -TimeoutSec 3 } catch { }
if ($localHealth -and ($localHealth.busy -or $localHealth.waiting -gt 0)) {
    throw 'Visitors are active. Wait for the game and queue to become empty before switching the endpoint.'
}
$config | Add-Member -NotePropertyName public_origin -NotePropertyValue $PublicUrl -Force
$config | Add-Member -NotePropertyName allowed_origins -NotePropertyValue @('https://chasheo.github.io') -Force
$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ConfigPath -Encoding utf8
if ($localHealth) { & (Join-Path $PSScriptRoot 'stop-demo.ps1') -ConfigPath $ConfigPath }
& (Join-Path $PSScriptRoot 'start-demo.ps1') -ConfigPath $ConfigPath
$publicHealth = Invoke-RestMethod -Uri ($PublicUrl + '/api/health') -Headers @{Origin='https://chasheo.github.io'} -TimeoutSec 25
if (-not $publicHealth.ok -or $publicHealth.capacity -ne 1 -or $publicHealth.heartbeat_timeout -ne 120) {
    throw 'The public URL does not reach the expected single-seat, two-minute game host.'
}
Write-Output 'The public gateway is ready.'
if ($Publish) {
    Push-Location $PSScriptRoot
    try {
        $branch = (git branch --show-current).Trim()
        if ($LASTEXITCODE -ne 0 -or $branch -in @('main','master') -or -not $branch) { throw 'Deploy from the reviewed feature branch.' }
        if (git status --porcelain) { throw 'Commit and push the intended source changes before deploying.' }
        gh variable set VITE_API_BASE_URL --body $PublicUrl --repo chasheo/chasheo.github.io
        if ($LASTEXITCODE -ne 0) { throw 'Could not update the public endpoint variable.' }
        gh workflow run pages.yml --ref $branch --repo chasheo/chasheo.github.io
        if ($LASTEXITCODE -ne 0) { throw 'Could not start the Pages deployment.' }
        Write-Output 'GitHub Pages deployment requested. Check the repository Actions result.'
    } finally { Pop-Location }
}
