# Bulk-imports foods and bulk units from a CSV file exported from Excel.
#
# Previews by default - nothing is written until you add -Apply.
#
# Usage:
#   .\scripts\import-catalogue.ps1 -File foods.csv           # preview
#   .\scripts\import-catalogue.ps1 -File foods.csv -Apply    # write

param(
    [Parameter(Mandatory = $true)]
    [string]$File,

    [string]$DatabaseUrl,

    # Actually write. Without this the script only reports what it would do.
    [switch]$Apply,

    # Also update weight and cost on foods already in the catalogue when the
    # spreadsheet now says something different. Use this to fill in costs you
    # did not have at first import. A blank cost never overwrites a real one.
    [switch]$Update
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

. (Join-Path $PSScriptRoot "_db-url.ps1")

if (-not (Test-Path $File)) {
    Write-Host "`nCannot find the file: $File" -ForegroundColor Red
    Write-Host "Give the path to your CSV, e.g. .\scripts\import-catalogue.ps1 -File C:\Users\rober\Desktop\foods.csv"
    exit 1
}
$File = (Resolve-Path $File).Path

Write-Host ""
Write-Host "Import catalogue from a spreadsheet" -ForegroundColor Cyan
Write-Host "-----------------------------------"
if ($Apply) {
    Write-Host "Mode: APPLY - records will be created." -ForegroundColor Yellow
} else {
    Write-Host "Mode: PREVIEW - nothing will be written." -ForegroundColor Green
}
Write-Host "File: $File"
Write-Host ""

$url = Get-OpherDbUrl -Explicit $DatabaseUrl
Assert-PostgresUrl $url


$env:DATABASE_URL = $url
$env:IMPORT_FILE = $File
$env:IMPORT_APPLY = if ($Apply) { "1" } else { "0" }
$env:IMPORT_UPDATE = if ($Update) { "1" } else { "0" }

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
    npx tsx scripts/import-catalogue.ts
    $exit = $LASTEXITCODE
}
finally {
    git checkout --quiet prisma/schema.prisma
    npx prisma generate | Out-Null
    $env:DATABASE_URL = $null
    $env:IMPORT_FILE = $null
    $env:IMPORT_APPLY = $null
    $env:IMPORT_UPDATE = $null
}

Write-Host ""
if ($exit -eq 0) {
    if (-not $Apply) {
        Write-Host "Preview finished. Re-run with -Apply once the numbers look right." -ForegroundColor Cyan
    }
    Write-Host "Local setup restored to SQLite." -ForegroundColor Green
} else {
    Write-Host "Import did not run - read the message above. Local setup restored." -ForegroundColor Red
}
