$ErrorActionPreference = 'Stop'

if ($env:CI -ne 'true') {
  throw 'Installer integration checks may only run on a disposable CI runner.'
}

$installer = (Resolve-Path 'dist/release/tournament-overlay-windows-x64-setup.exe').Path
$installation = Join-Path $env:LOCALAPPDATA 'Programs\Tournament Overlay'
$executable = Join-Path $installation 'app\TournamentOverlay.exe'
$userData = Join-Path $env:APPDATA 'Tournament Overlay'
$validation = Join-Path (Get-Location) 'dist\packaging\installer-validation'
$preservedFile = Join-Path $userData "installer-check-$([guid]::NewGuid()).txt"
$server = $null

if (Test-Path -LiteralPath $installation) {
  throw 'Refusing to modify an existing Tournament Overlay installation.'
}
New-Item -ItemType Directory -Force -Path $validation, $userData | Out-Null
Set-Content -LiteralPath $preservedFile -Value 'Keep user data through upgrades and uninstall.'

function Invoke-Installer([string] $File, [string] $LogName) {
  $log = Join-Path $validation $LogName
  $process = Start-Process -FilePath $File -PassThru -Wait -ArgumentList @(
    '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', "/LOG=`"$log`""
  )
  return $process.ExitCode
}

function Assert-UserData {
  if (-not (Test-Path -LiteralPath $preservedFile)) {
    throw 'Installer removed data outside its installation directory.'
  }
}

try {
  $unknownDirectory = Join-Path $installation 'app'
  $unknownFile = Join-Path $unknownDirectory 'unowned-test-file.txt'
  New-Item -ItemType Directory -Force -Path $unknownDirectory | Out-Null
  Set-Content -LiteralPath $unknownFile -Value 'Not owned by this installer.'
  if ((Invoke-Installer $installer 'unrecognized-rejected.log') -eq 0 -or
      -not (Test-Path -LiteralPath $unknownFile)) {
    throw 'Installer did not protect an unrecognized application directory.'
  }
  Remove-Item -LiteralPath $unknownFile
  Remove-Item -LiteralPath $unknownDirectory
  Remove-Item -LiteralPath $installation

  if ((Invoke-Installer $installer 'install.log') -ne 0) {
    throw 'Per-user installation failed.'
  }
  if (-not (Test-Path -LiteralPath $executable)) {
    throw 'Installer did not place the executable in the expected per-user directory.'
  }
  $shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Tournament Overlay\Tournament Overlay.lnk'
  if (-not (Test-Path -LiteralPath $shortcut)) {
    throw 'Installer did not create the Start Menu shortcut.'
  }

  $env:EXECUTABLE_PATH = $executable
  npm run test:executable
  if ($LASTEXITCODE -ne 0) { throw 'Installed executable smoke test failed.' }

  $staleAsset = Join-Path $installation 'app\public\obsolete-installer-test.js'
  Set-Content -LiteralPath $staleAsset -Value 'This asset must not survive replacement.'
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  $env:PORT = "$port"
  $env:OPEN_BROWSER = 'false'
  $env:CONFIG_FILE = Join-Path $validation 'config.json'
  $env:STATE_FILE = Join-Path $validation 'operator-state.json'
  $server = Start-Process -FilePath $executable -PassThru `
    -RedirectStandardOutput (Join-Path $validation 'server.log') `
    -RedirectStandardError (Join-Path $validation 'server-error.log')
  $ready = $false
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    if ($server.HasExited) { throw 'Installed executable exited before becoming ready.' }
    try {
      $response = Invoke-WebRequest "http://127.0.0.1:$port/api/health" -TimeoutSec 1
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 100 }
  }
  if (-not $ready) { throw 'Installed executable did not become ready.' }
  if ((Invoke-Installer $installer 'running-rejected.log') -eq 0) {
    throw 'Installer unexpectedly replaced a running executable.'
  }
  if ((Invoke-Installer (Join-Path $installation 'unins000.exe') 'running-uninstall-rejected.log') -eq 0) {
    throw 'Uninstaller unexpectedly removed a running executable.'
  }
  if ($server.HasExited -or -not (Test-Path -LiteralPath $staleAsset)) {
    throw 'Rejected installation changed the running application or its assets.'
  }
  Assert-UserData
  Stop-Process -Id $server.Id
  $server.WaitForExit()

  if ((Invoke-Installer $installer 'upgrade.log') -ne 0) {
    throw 'Replacing the stopped application failed.'
  }
  if (Test-Path -LiteralPath $staleAsset) {
    throw 'Upgrade left stale assets in the versioned application directory.'
  }
  Assert-UserData
  npm run test:executable
  if ($LASTEXITCODE -ne 0) { throw 'Upgraded executable smoke test failed.' }

  if ((Invoke-Installer (Join-Path $installation 'unins000.exe') 'uninstall.log') -ne 0) {
    throw 'Uninstall failed.'
  }
  if (Test-Path -LiteralPath $executable) {
    throw 'Uninstall did not remove the executable.'
  }
  Assert-UserData
  Write-Output 'Installer, running-process protection, asset replacement, and data preservation passed.'
} finally {
  if ($null -ne $server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id
    $server.WaitForExit()
  }
  Remove-Item -LiteralPath $preservedFile -Force -ErrorAction SilentlyContinue
}
