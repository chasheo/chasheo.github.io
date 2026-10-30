param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot '.local.json'),
    [string]$PythonPath = 'C:\SeeleAI\seele-dev\temp\chasheo-demo\venv\Scripts\python.exe'
)
$ErrorActionPreference = 'Stop'
$configFile = (Resolve-Path -LiteralPath $ConfigPath).ProviderPath
$config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $PythonPath)) { throw 'Demo Python environment is missing. Follow README.md setup.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist\index.html'))) { throw 'Build the website first: npm run build' }
New-Item -ItemType Directory -Path $config.runtime_dir -Force | Out-Null
$receipt = Join-Path $config.runtime_dir 'service.json'
if (Test-Path -LiteralPath $receipt) {
    $previous = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
    $existing = Get-Process -Id $previous.pid -ErrorAction SilentlyContinue
    if ($existing -and [Math]::Abs(($existing.StartTime.ToUniversalTime() - ([datetime]$previous.started_utc).ToUniversalTime()).TotalSeconds) -lt 1) {
        Write-Output 'The local demo is already running: http://127.0.0.1:18790/'
        exit 0
    }
}
$arguments = @('-m', 'server.app', '--config', ('"' + $configFile + '"'))
$process = Start-Process -FilePath $PythonPath -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $config.runtime_dir 'console.log') -RedirectStandardError (Join-Path $config.runtime_dir 'console-error.log')
# The host writes its own PID receipt: venv python.exe is only a redirector parent.
for ($attempt=0; $attempt -lt 20; $attempt++) {
    $process.Refresh()
    if ($process.HasExited) { throw 'Demo startup failed. Read runtime/host.log and console-error.log.' }
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:18790/api/health' -TimeoutSec 1
        if ($health.ok -and $health.capacity -eq 1) { Write-Output 'Local demo ready: http://127.0.0.1:18790/'; exit 0 }
    } catch { }
    Start-Sleep -Milliseconds 500
}
throw 'Demo is still starting. Inspect runtime/host.log before starting it again.'
