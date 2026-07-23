# polylane CLI installer for Windows (PowerShell 5.1+ / 7+).
#
#   irm https://polylane.com/install.ps1 | iex
#
# Installs the bundled CLI to $env:USERPROFILE\.polylane\bin\ and (if needed)
# prints the line to add to your PATH. Node 20+ must be installed.
# Override the version or install prefix with env vars:
#
#   $env:POLYLANE_VERSION='v0.1.0'; irm https://polylane.com/install.ps1 | iex
#   $env:POLYLANE_PREFIX='C:\tools'; irm https://polylane.com/install.ps1 | iex

$ErrorActionPreference = 'Stop'

$Repo        = 'coreplanelabs/cli'
$BinName     = 'polylane'
$Version     = if ($env:POLYLANE_VERSION) { $env:POLYLANE_VERSION } else { 'latest' }
$PrefixDir   = if ($env:POLYLANE_PREFIX) { $env:POLYLANE_PREFIX } else { Join-Path $env:USERPROFILE '.polylane\bin' }
$BundleAsset = 'polylane.mjs'

function Die([string]$msg) {
  Write-Host "error: $msg" -ForegroundColor Red
  exit 1
}
function Info([string]$msg) { Write-Host $msg -ForegroundColor DarkGray }
function Ok([string]$msg)   { Write-Host "✓ $msg" -ForegroundColor Green }

# --- preflight --------------------------------------------------------------

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Die "Node.js 20+ is required but 'node' was not found.`nInstall from https://nodejs.org, then re-run."
}
$nodeVersion = (& node -v) -replace '^v', ''
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 20) {
  Die "Node.js 20+ is required (found v$nodeVersion)."
}

# --- resolve download URL ---------------------------------------------------

if ($Version -eq 'latest') {
  $DownloadUrl = "https://github.com/$Repo/releases/latest/download/$BundleAsset"
} else {
  $DownloadUrl = "https://github.com/$Repo/releases/download/$Version/$BundleAsset"
}

# --- download --------------------------------------------------------------

$TmpFile = Join-Path ([System.IO.Path]::GetTempPath()) "$BundleAsset.$([guid]::NewGuid())"
Info "Downloading $DownloadUrl"
try {
  Invoke-WebRequest -Uri $DownloadUrl -OutFile $TmpFile -UseBasicParsing -ErrorAction Stop
} catch {
  Die "download failed — check your network and that the release exists`n  $_"
}

$firstLine = Get-Content -Path $TmpFile -TotalCount 1
if (-not $firstLine.StartsWith('#!')) {
  Remove-Item $TmpFile -Force
  Die "downloaded file does not look like a polylane CLI bundle"
}

# --- install ---------------------------------------------------------------

New-Item -ItemType Directory -Force -Path $PrefixDir | Out-Null
$TargetMjs = Join-Path $PrefixDir "$BinName.mjs"
$TargetCmd = Join-Path $PrefixDir "$BinName.cmd"

Move-Item -Force -Path $TmpFile -Destination $TargetMjs

# Shim so `polylane` works from CMD / PowerShell without calling node explicitly.
$cmdShim = @"
@echo off
node "%~dp0$BinName.mjs" %*
"@
Set-Content -Path $TargetCmd -Value $cmdShim -Encoding ASCII

Ok "installed $TargetMjs"
try {
  $installedVersion = & $TargetCmd --version 2>$null
  Ok "polylane $installedVersion"
} catch {
  # non-fatal — user can still run it manually
}

# --- PATH hint -------------------------------------------------------------

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$PrefixDir*") {
  Write-Host ''
  Info "Add $PrefixDir to your PATH:"
  Write-Host "    setx PATH `"$PrefixDir;%PATH%`""
  Info 'Or set permanently with PowerShell:'
  Write-Host "    [Environment]::SetEnvironmentVariable('Path', '$PrefixDir;' + [Environment]::GetEnvironmentVariable('Path','User'), 'User')"
}

Write-Host ''
Write-Host "Run " -NoNewline
Write-Host "polylane --help" -NoNewline -ForegroundColor White
Write-Host " to get started."
