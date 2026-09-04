# Deletes every basket, its sizes, and the orders attached to them.
# Keeps cities, delivery dates, the food catalogue and all accounts.
#
# Refuses outright if any order has money attached. Refund those through
# /operator/cycles first.
#
# Previews by default - nothing is deleted until you add -Apply.
#
# Usage:
#   .\scripts\wipe-baskets.ps1           # preview
#   .\scripts\wipe-baskets.ps1 -Apply    # delete

param(
    [string]$DatabaseUrl,

    # Actually delete. Without this the script only reports what it would do.
    [switch]$Apply
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

. (Join-Path $PSScriptRoot "_db-url.ps1")

Write-Host ""
Write-Host "Wipe baskets" -ForegroundColor Cyan
Write-Host "------------"
if ($Apply) {
    Write-Host "Mode: APPLY - baskets and their orders will be deleted." -ForegroundColor Yellow
} else {
    Write-Host "Mode: PREVIEW - nothing will be deleted." -ForegroundColor Green
}
Write-Host ""

$url = Get-OpherDbUrl -Explicit $DatabaseUrl
Assert-PostgresUrl $url

$env:DATABASE_URL = $url
$env:WIPE_APPLY = if ($Apply) { "1" } else { "0" }

node scripts/select-prisma-provider.mjs

$schema = Get-Content "prisma/schema.prisma" -Raw
if ($schema -notmatch 'provider\s*=\s*"postgresql"') {
    Write-Host "`nSTOPPED. Provider is not postgresql - nothing was deleted." -ForegroundColor Red
    git checkout --quiet prisma/schema.prisma
    exit 1
}

# try/finally so the local checkout is always restored, even on failure.
$exit = 1
try {
    npx prisma generate | Out-Null
    npx tsx scripts/wipe-baskets.ts
    $exit = $LASTEXITCODE
}
finally {
    git checkout --quiet prisma/schema.prisma
    npx prisma generate | Out-Null
    $env:DATABASE_URL = $null
    $env:WIPE_APPLY = $null
}

Write-Host ""
if ($exit -eq 0) {
    if (-not $Apply) {
        Write-Host "Preview finished. Re-run with -Apply to delete." -ForegroundColor Cyan
    }
    Write-Host "Local setup restored to SQLite." -ForegroundColor Green
} else {
    Write-Host "Did not complete - read the message above. Local setup restored." -ForegroundColor Red
}
