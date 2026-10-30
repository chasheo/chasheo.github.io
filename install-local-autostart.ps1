param(
    [switch]$Remove,
    [string]$ConfigPath = (Join-Path $PSScriptRoot '.local.json'),
    [string]$PythonPath = 'C:\SeeleAI\seele-dev\temp\chasheo-demo\venv\Scripts\python.exe'
)
$ErrorActionPreference = 'Stop'
$taskName = 'chasheo-worlds-local-host'
$launcher = Join-Path $PSScriptRoot 'start-demo.ps1'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    if (-not (@($existing.Actions | Where-Object { $_.Arguments -is [string] -and $_.Arguments.Contains($launcher) }).Count)) {
        throw 'A task with this name belongs to another launcher. It has not been changed.'
    }
}
if ($Remove) {
    if ($existing) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
    Write-Output 'Automatic host startup removed. The running game host has not been stopped.'
    exit 0
}
$configFile = (Resolve-Path -LiteralPath $ConfigPath).ProviderPath
$pythonFile = (Resolve-Path -LiteralPath $PythonPath).ProviderPath
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -ConfigPath "{1}" -PythonPath "{2}"' -f $launcher, $configFile, $pythonFile
$action = New-ScheduledTaskAction -Execute $shell -Argument $arguments -WorkingDirectory $PSScriptRoot
$login = New-ScheduledTaskTrigger -AtLogOn -User $identity
# Reconcile a crashed host while this user is logged in. start-demo.ps1 checks PID ownership;
# the server also holds a Windows file lock and owns game processes with a Job Object.
$reconcile = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($login, $reconcile) -Principal $principal -Settings $settings -Description 'Start and recover the single-seat local game host while its owner is logged in; no credentials are stored.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Local host login startup and one-minute recovery installed. Cloudflared remains a separate Windows service.'
