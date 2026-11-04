param(
    [switch]$Remove,
    [string]$ConfigPath = (Join-Path $PSScriptRoot '.local.json'),
    [string]$PythonPath = ''
)
$ErrorActionPreference = 'Stop'
$taskName = 'chasheo-worlds-local-host'
$launcher = Join-Path $PSScriptRoot 'start-demo.ps1'
$hiddenLauncher = Join-Path $PSScriptRoot 'start-demo-hidden.vbs'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    if (-not (@($existing.Actions | Where-Object { $_.Arguments -is [string] -and ($_.Arguments.Contains($launcher) -or $_.Arguments.Contains($hiddenLauncher)) }).Count)) {
        throw 'A task with this name belongs to another launcher. It has not been changed.'
    }
}
if ($Remove) {
    if ($existing) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
    Write-Output 'Automatic host startup removed. The running game host has not been stopped.'
    exit 0
}
$configFile = (Resolve-Path -LiteralPath $ConfigPath).ProviderPath
if (-not $PythonPath) {
    $PythonPath = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $PythonPath)) {
        $PythonPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'seele-dev\temp\chasheo-demo\venv\Scripts\python.exe'
    }
}
$pythonFile = (Resolve-Path -LiteralPath $PythonPath).ProviderPath
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$shell = Join-Path $env:SystemRoot 'System32\wscript.exe'
$arguments = '"{0}" "{1}" "{2}"' -f $hiddenLauncher, $configFile, $pythonFile
$action = New-ScheduledTaskAction -Execute $shell -Argument $arguments -WorkingDirectory $PSScriptRoot
$login = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $login -Principal $principal -Settings $settings -Description 'Silently start the single-seat local game host at user login; no credentials are stored.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Silent local host login startup installed. Cloudflared remains a separate Windows service.'
