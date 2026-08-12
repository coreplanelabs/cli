# polylane CLI installer for Windows (PowerShell 5.1+ / 7+).
#
#   irm https://polylane.com/install.ps1 | iex
#
# Installs the bundled CLI to $env:USERPROFILE\.polylane\bin\ and (if needed)
# adds it to your user PATH. Node 20+ must be installed.
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

# True if $PathString (a ';'-separated PATH value) already contains $Dir,
# comparing case-insensitively and ignoring trailing backslashes.
function Test-PathHasDir([string]$PathString, [string]$Dir) {
  $norm = $Dir.TrimEnd('\')
  foreach ($entry in ($PathString -split ';')) {
    if ($entry -and ($entry.TrimEnd('\') -ieq $norm)) { return $true }
  }
  return $false
}

# Returns $PathString with $Dir appended (unchanged if already present).
function Add-DirToPath([string]$PathString, [string]$Dir) {
  if (Test-PathHasDir $PathString $Dir) { return $PathString }
  if ([string]::IsNullOrWhiteSpace($PathString)) { return $Dir }
  return $PathString.TrimEnd(';') + ';' + $Dir
}

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

# --- PATH -------------------------------------------------------------------

# Persist $PrefixDir on the user PATH (never setx — it truncates long PATHs,
# and never the merged Machine+User value — only the User value is rewritten).
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (Test-PathHasDir $userPath $PrefixDir)) {
  try {
    [Environment]::SetEnvironmentVariable('Path', (Add-DirToPath $userPath $PrefixDir), 'User')
    Ok "added $PrefixDir to your PATH"
    Info 'New terminals pick it up automatically.'
  } catch {
    Info "could not add $PrefixDir to your PATH automatically ($_)"
    Info 'Add it yourself with PowerShell:'
    Write-Host "    [Environment]::SetEnvironmentVariable('Path', '$PrefixDir;' + [Environment]::GetEnvironmentVariable('Path','User'), 'User')"
  }
}

# Make `polylane` work in this session too, without a restart.
if (-not (Test-PathHasDir $env:Path $PrefixDir)) {
  $env:Path = "$PrefixDir;$env:Path"
}

Write-Host ''
Write-Host "Run " -NoNewline
Write-Host "polylane --help" -NoNewline -ForegroundColor White
Write-Host " to get started."
