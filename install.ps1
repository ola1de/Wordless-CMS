# WORDLESS installer wrapper (Windows PowerShell).
# Checks for Node.js + npm, installs dependencies, then runs the wizard.
# No remote code is downloaded or executed beyond `npm install` from the
# project's own package.json.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js 20+ is required: https://nodejs.org/'
  exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error 'npm is required (it ships with Node.js 20+).'
  exit 1
}

npm install
npm run setup
