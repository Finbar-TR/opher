# Saves the production database connection string once, to a git-ignored file,
# so no other script ever has to display it.
#
# It opens Notepad rather than prompting: nothing you paste is echoed to the
# terminal, so it cannot end up in scrollback, a screenshot, or a transcript.
#
# Usage:  .\scripts\save-db-url.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$path = Join-Path $PSScriptRoot ".db-url"

if (-not (Test-Path $path)) {
    New-Item -ItemType File -Path $path | Out-Null
    [System.IO.File]::WriteAllText($path, "", (New-Object System.Text.UTF8Encoding $false))
}

Write-Host ""
Write-Host "Save the database connection string" -ForegroundColor Cyan
Write-Host "-----------------------------------"
Write-Host "Notepad is opening. Paste your Neon connection string as the only"
Write-Host "line, then save and close it."
Write-Host ""
Write-Host "The file is git-ignored, so it never reaches GitHub." -ForegroundColor DarkGray
Write-Host ""

Start-Process notepad.exe -ArgumentList $path -Wait

$saved = (Get-Content $path -Raw).Trim()

if ([string]::IsNullOrWhiteSpace($saved)) {
    Write-Host "Nothing saved - the file is empty." -ForegroundColor Yellow
    exit 1
}
if ($saved -notmatch '^postgres(ql)?://') {
    Write-Host "That does not look like a Postgres URL - it should start with postgresql://" -ForegroundColor Red
    Write-Host "Run this again and paste the connection string from Neon." -ForegroundColor Red
    exit 1
}

# Show the host only, never the credentials, so you can confirm it is the right
# database without the password appearing anywhere.
$dbHost = ($saved -replace '^postgres(ql)?://', '') -replace '^[^@]*@', '' -replace '/.*$', ''
Write-Host ""
Write-Host "Saved. Scripts will now connect to:" -ForegroundColor Green
Write-Host "  $dbHost"
Write-Host ""
Write-Host "You will not be asked for it again. To change it, run this script again."
