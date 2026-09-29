<#
.SYNOPSIS
  PteroOps installer for Windows.

.DESCRIPTION
  Default (build from source):
    irm https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.ps1 | iex

  With parameters (recommended when you want options):
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.ps1))) -Method release -Version 0.1.0

.PARAMETER Method
  source  = download + build from git (default, always works)
  release = prebuilt tarball from GitHub Releases (no build step)
  npm     = install the published package from the npm registry

.PARAMETER Version
  Version to install for -Method release/-Method npm (default: latest/none).

.PARAMETER Prefix
  Install root (default: %LOCALAPPDATA%\PteroOps).

.PARAMETER BinDir
  Where the `pteroops` launcher is placed (default: <Prefix>\bin).

.PARAMETER Ref
  Branch or tag to build for -Method source (default: main).

.PARAMETER SourceZip
  Install from a local zip instead of downloading (source method, offline installs).

.PARAMETER SourceDir
  Install from a local checkout instead of downloading (source method).

.PARAMETER ReleaseTarball
  Override the GitHub release tarball URL or local path (offline installs).

.PARAMETER NpmRegistry
  Alternate npm registry for -Method npm.

.PARAMETER InstallNode
  Attempt to install Node.js LTS via winget when Node.js is missing.

.PARAMETER NoPathUpdate
  Do not modify the user PATH.

.PARAMETER Uninstall
  Remove the app and launcher (keeps data unless -Purge is also given).

.PARAMETER Purge
  With -Uninstall: also delete stored data (SQLite, snapshots).
#>
[CmdletBinding()]
param(
  [ValidateSet('source', 'release', 'npm')]
  [string]$Method = 'source',
  [string]$Version,
  [string]$Prefix = (Join-Path $env:LOCALAPPDATA 'PteroOps'),
  [string]$BinDir,
  [string]$Ref = 'main',
  [string]$SourceZip,
  [string]$SourceDir,
  [string]$ReleaseTarball,
  [string]$NpmRegistry,
  [switch]$InstallNode,
  [switch]$NoPathUpdate,
  [switch]$Uninstall,
  [switch]$Purge
)

$ErrorActionPreference = 'Stop'
$Repo = 'PotenFYR-Studios/PteroOps-MCP'
$MinNodeMajor = 22
$AppDir = Join-Path $Prefix 'app'
$RuntimeDir = Join-Path $Prefix 'runtime'
$DataDir = Join-Path $Prefix 'data'
if (-not $BinDir) { $BinDir = Join-Path $Prefix 'bin' }
$Launcher = Join-Path $BinDir 'pteroops.cmd'
$NpmFlags = @('--no-audit', '--no-fund', '--loglevel=error', '--ignore-scripts')

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Say([string]$Message) { Write-Host "  $Message" }
function Fail([string]$Message) { Write-Host "`nerror: $Message" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- uninstall
if ($Uninstall) {
  Write-Step 'Uninstalling PteroOps'
  if (Test-Path $AppDir) { Remove-Item -Recurse -Force $AppDir }
  if (Test-Path $RuntimeDir) { Remove-Item -Recurse -Force $RuntimeDir }
  if (Test-Path $Launcher) { Remove-Item -Force $Launcher }
  if ($Purge -and (Test-Path $DataDir)) {
    Remove-Item -Recurse -Force $DataDir
    Write-Say "data removed ($DataDir)"
  } else {
    Write-Say "kept data at $DataDir (use -Purge to remove it)"
  }
  Write-Say 'done'
  exit 0
}

# ------------------------------------------------------------------- node
Write-Step 'Checking Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  if ($InstallNode) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      Write-Say 'installing Node.js LTS via winget...'
      winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                  [Environment]::GetEnvironmentVariable('Path', 'User')
    } else {
      Fail 'winget is not available; install Node.js 22+ from https://nodejs.org'
    }
  } else {
    Fail "Node.js is not installed. Install Node.js $MinNodeMajor+ from https://nodejs.org (or re-run with -InstallNode)"
  }
}
$nodeVersion = (& node --version).TrimStart('v')
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt $MinNodeMajor) {
  Fail "Node.js $MinNodeMajor+ is required (found v$nodeVersion). Upgrade from https://nodejs.org"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail 'npm was not found next to node' }
Write-Say "node v$nodeVersion, npm $((& npm --version))"

if (-not $Version -and $SourceDir -and (Test-Path (Join-Path $SourceDir 'package.json'))) {
  $Version = (Get-Content (Join-Path $SourceDir 'package.json') -Raw | ConvertFrom-Json).version
}

$registryArgs = @()
if ($NpmRegistry) { $registryArgs = @('--registry', $NpmRegistry) }
$appEntry = ''

# ------------------------------------------------------------------- npm
if ($Method -eq 'npm') {
  $target = if ($Version) { "pteroops-mcp@$Version" } else { 'pteroops-mcp@latest' }
  Write-Step "Installing $target from the npm registry"
  if (Test-Path $RuntimeDir) { Remove-Item -Recurse -Force $RuntimeDir }
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  & npm install --omit=dev --prefix $RuntimeDir @registryArgs $target @NpmFlags
  if ($LASTEXITCODE -ne 0) { Fail 'npm install failed' }
  $appEntry = Join-Path $RuntimeDir 'node_modules\pteroops-mcp\dist\index.js'
  if (-not (Test-Path $appEntry)) { Fail "npm install did not produce $appEntry" }
  Write-Say "installed to $RuntimeDir"
}

# --------------------------------------------------------------- release
if ($Method -eq 'release') {
  if (-not $Version) { Fail 'the release method needs a version (pass -Version 0.1.0)' }
  $target = if ($ReleaseTarball) { $ReleaseTarball } else { "https://github.com/$Repo/releases/download/v$Version/pteroops-mcp-$Version.tgz" }
  Write-Step "Installing prebuilt release v$Version"
  if (Test-Path $RuntimeDir) { Remove-Item -Recurse -Force $RuntimeDir }
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  & npm install --omit=dev --prefix $RuntimeDir @registryArgs $target @NpmFlags
  if ($LASTEXITCODE -ne 0) { Fail "failed to install release tarball: $target" }
  $appEntry = Join-Path $RuntimeDir 'node_modules\pteroops-mcp\dist\index.js'
  if (-not (Test-Path $appEntry)) { Fail "release tarball did not produce $appEntry" }
  Write-Say "installed to $RuntimeDir"
}

# ---------------------------------------------------------------- source
if ($Method -eq 'source') {
  Write-Step "Fetching PteroOps ($Ref)"
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("pteroops-install-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $src = Join-Path $tmp 'src'
    if ($SourceDir) {
      if (-not (Test-Path $SourceDir)) { Fail "SourceDir does not exist: $SourceDir" }
      New-Item -ItemType Directory -Path $src | Out-Null
      Get-ChildItem -LiteralPath $SourceDir -Force | Where-Object {
        $_.Name -notin @('node_modules', 'dist', '.git', 'data', 'coverage')
      } | ForEach-Object { Copy-Item -Recurse -Force $_.FullName (Join-Path $src $_.Name) }
      Write-Say "copied from $SourceDir"
    } elseif ($SourceZip) {
      if (-not (Test-Path $SourceZip)) { Fail "SourceZip does not exist: $SourceZip" }
      Expand-Archive -LiteralPath $SourceZip -DestinationPath $tmp -Force
      $inner = Get-ChildItem -LiteralPath $tmp -Directory | Where-Object { $_.Name -ne '__src' } | Select-Object -First 1
      if (-not $inner) { Fail 'unexpected zip layout' }
      Move-Item $inner.FullName $src
      Write-Say "extracted from $SourceZip"
    } else {
      $zip = Join-Path $tmp 'pteroops.zip'
      $url = "https://codeload.github.com/$Repo/zip/refs/heads/$Ref"
      Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
      Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
      $inner = Get-ChildItem -LiteralPath $tmp -Directory | Where-Object { $_.Name -ne '__src' } | Select-Object -First 1
      if (-not $inner) { Fail 'unexpected zip layout' }
      Move-Item $inner.FullName $src
      Write-Say "downloaded from GitHub ($Ref)"
    }

    Write-Step 'Installing dependencies and building (this takes ~1 minute)'
    New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
    $appNew = Join-Path $Prefix 'app.new'
    if (Test-Path $appNew) { Remove-Item -Recurse -Force $appNew }
    Move-Item $src $appNew
    Push-Location $appNew
    try {
      & npm install --no-audit --no-fund --loglevel=error
      if ($LASTEXITCODE -ne 0) { Fail 'npm install failed' }
      & npm run build --silent
      if ($LASTEXITCODE -ne 0) { Fail 'npm run build failed' }
      & npm prune --omit=dev --no-audit --no-fund --loglevel=error 2>$null | Out-Null
    } finally {
      Pop-Location
    }
    if (Test-Path $AppDir) { Remove-Item -Recurse -Force $AppDir }
    Move-Item $appNew $AppDir
    $appEntry = Join-Path $AppDir 'dist\index.js'
    if (-not (Test-Path $appEntry)) { Fail 'build did not produce dist\index.js' }
    Write-Say "installed to $AppDir"
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}

# --------------------------------------------------------------- launcher
Write-Step 'Installing the pteroops launcher'
New-Item -ItemType Directory -Force -Path $BinDir, $DataDir | Out-Null
$launcherContent = @"
@echo off
if "%PTERO_DATA_DIR%"=="" set "PTERO_DATA_DIR=$DataDir"
node "$appEntry" %*
"@
Set-Content -LiteralPath $Launcher -Value $launcherContent -Encoding ASCII
Write-Say "$Launcher  ->  $appEntry"

if (-not $NoPathUpdate) {
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $entries = @()
  if ($userPath) { $entries = $userPath.Split(';') | Where-Object { $_ -ne '' } }
  if ($entries -notcontains $BinDir) {
    $newPath = (@($entries) + $BinDir) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    $env:Path = "$env:Path;$BinDir"
    Write-Say "added $BinDir to your user PATH (open a new terminal to use 'pteroops')"
  }
}

# -------------------------------------------------------------- done
Write-Step "Done (method: $Method)"
@"

  Start using PteroOps:

    1. Get an API key: your panel -> Account -> API Credentials -> Create API Key
    2. Configure your MCP client (Claude Desktop example):

       {
         "mcpServers": {
           "pteroops": {
             "command": "node",
             "args": ["$($appEntry -replace '\\','\\')"],
             "env": {
               "PTERO_PANEL_MY_URL": "https://panel.example.com",
               "PTERO_PANEL_MY_CLIENT_KEY": "ptlc_...",
               "PTERO_DEFAULT_PANEL": "my"
             }
           }
         }
       }

    3. Or run it yourself:   pteroops --help
       Web console (HTTP):   pteroops --transport http
       Update:               re-run this installer
       Uninstall:            & ([scriptblock]::Create((irm https://raw.githubusercontent.com/$Repo/main/scripts/install.ps1))) -Uninstall [-Purge]

  Docs: https://github.com/$Repo  ·  https://github.com/$Repo/blob/main/docs/installation.md
"@ | Write-Host
