# Sets a city's launch date, or switches a city on and off.
#
# Previews by default - nothing is written until you add -Apply.
#
# Examples:
#   .\scripts\set-city.ps1 -City Sheffield -Start 2026-09-19        # preview
#   .\scripts\set-city.ps1 -City Sheffield -Start 2026-09-19 -On -Apply
#   .\scripts\set-city.ps1 -City London -Off -Apply                 # hold it back
#   .\scripts\set-city.ps1 -City London                             # just look

param(
    # One city, or several separated by commas:
    #   -City Sheffield
    #   -City London,Birmingham,Manchester
    [Parameter(Mandatory = $true)]
    [string[]]$City,

    # First delivery date, as 2026-09-19. Every later delivery follows from it
    # at the city's cadence (14 days), with orders closing 3 days before each.
    [string]$Start,

    [switch]$On,
    [switch]$Off,

    [string]$DatabaseUrl,

    # Actually write. Without this the script only reports what it would do.
    [switch]$Apply
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

. (Join-Path $PSScriptRoot "_db-url.ps1")

if ($On -and $Off) {
    Write-Host "`nPick one of -On or -Off, not both." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "City schedule" -ForegroundColor Cyan
Write-Host "-------------"
if ($Apply) {
    Write-Host "Mode: APPLY - the change will be saved." -ForegroundColor Yellow
} else {
    Write-Host "Mode: PREVIEW - nothing will be written." -ForegroundColor Green
}
Write-Host ""

$url = Get-OpherDbUrl -Explicit $DatabaseUrl
Assert-PostgresUrl $url


$env:DATABASE_URL = $url
$env:CITY_NAMES = (($City | ForEach-Object { $_.Trim() }) -join "|")
$env:CITY_START = $Start
$env:CITY_APPLY = if ($Apply) { "1" } else { "0" }
$env:CITY_ONOFF = if ($On) { "on" } elseif ($Off) { "off" } else { "" }

node scripts/select-prisma-provider.mjs

$schema = Get-Content "prisma/schema.prisma" -Raw
if ($schema -notmatch 'provider\s*=\s*"postgresql"') {
    Write-Host "`nSTOPPED. Provider is not postgresql - nothing was changed." -ForegroundColor Red
    git checkout --quiet prisma/schema.prisma
    exit 1
}

# try/finally so the local checkout is always restored, even on failure.
$exit = 1
try {
    npx prisma generate | Out-Null
    npx tsx scripts/set-city.ts
    $exit = $LASTEXITCODE
}
finally {
    git checkout --quiet prisma/schema.prisma
    npx prisma generate | Out-Null
    $env:DATABASE_URL = $null
    $env:CITY_NAMES = $null
    $env:CITY_START = $null
    $env:CITY_APPLY = $null
    $env:CITY_ONOFF = $null
}

Write-Host ""
if ($exit -eq 0) {
    if (-not $Apply) {
        Write-Host "Preview finished. Re-run with -Apply once it looks right." -ForegroundColor Cyan
    }
    Write-Host "Local setup restored to SQLite." -ForegroundColor Green
} else {
    Write-Host "Did not run - read the message above. Local setup restored." -ForegroundColor Red
}
