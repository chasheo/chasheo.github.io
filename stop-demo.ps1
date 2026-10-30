param([string]$ConfigPath = (Join-Path $PSScriptRoot '.local.json'))
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$receipt = Join-Path $config.runtime_dir 'service.json'
if (-not (Test-Path -LiteralPath $receipt)) { throw 'No service receipt. Do not stop unrelated Python processes.' }
$owned = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
$process = Get-Process -Id $owned.pid -ErrorAction SilentlyContinue
if (-not $process) { Write-Output 'The demo host is already stopped.'; exit 0 }
if ([Math]::Abs(($process.StartTime.ToUniversalTime() - ([datetime]$owned.started_utc).ToUniversalTime()).TotalSeconds) -ge 1) { throw 'PID was reused. Refusing to stop a different process.' }
if ($process.Path -ne $owned.python) { throw 'Process executable does not match the demo receipt.' }
Stop-Process -Id $process.Id -ErrorAction Stop
$process.WaitForExit(10000) | Out-Null
Write-Output 'Demo stopped. Windows releases its game and signalling process trees.'
