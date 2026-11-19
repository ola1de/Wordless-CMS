# WORDLESS installer wrapper (Windows PowerShell).
# Checks for Node.js 20+ + npm, installs dependencies, then runs the wizard.
# No remote code is downloaded or executed beyond `npm install` from the
# project's own package.json. Arguments are passed through to the wizard,
# e.g. .\install.ps1 --local  (non-interactive local setup).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js 20+ is required: https://nodejs.org/'
  exit 1
}
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) {
  Write-Error "Node.js 20+ is required (found $(node --version)): https://nodejs.org/"
  exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error 'npm is required (it ships with Node.js 20+).'
  exit 1
}

npm install
npm run setup -- $args
