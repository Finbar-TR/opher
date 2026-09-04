# Adds the eight cities and their delivery windows to a production database.
# Creates no user accounts - see scripts/seed-cities.ts for why that matters.
#
# Usage:  .\scripts\seed-cities.ps1
#     or: .\scripts\seed-cities.ps1 -DatabaseUrl "postgresql://..."

param(
    [string]$DatabaseUrl
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

. (Join-Path $PSScriptRoot "_db-url.ps1")

Write-Host ""
Write-Host "Add cities and delivery windows" -ForegroundColor Cyan
Write-Host "-------------------------------"
Write-Host "Paste the same connection string you used for the migration."
Write-Host ""

# Plain prompt, not -AsSecureString: the masked prompt cannot handle Ctrl+V.
# See the comment in migrate-production.ps1.
$url = Get-OpherDbUrl -Explicit $DatabaseUrl
Assert-PostgresUrl $url


$env:DATABASE_URL = $url

# The Prisma client must be built for Postgres to talk to Postgres. Generate it
# for this run, then put the local checkout back afterwards.
node scripts/select-prisma-provider.mjs

$schema = Get-Content "prisma/schema.prisma" -Raw
if ($schema -notmatch 'provider\s*=\s*"postgresql"') {
    Write-Host "`nSTOPPED. Provider is not postgresql - nothing was written." -ForegroundColor Red
    git checkout --quiet prisma/schema.prisma
    exit 1
}

# try/finally so the local checkout is always restored, even on failure.
$seedExit = 1
try {
    npx prisma generate | Out-Null
    npx tsx scripts/seed-cities.ts
    $seedExit = $LASTEXITCODE
}
finally {
    git checkout --quiet prisma/schema.prisma
    npx prisma generate | Out-Null
    $env:DATABASE_URL = $null
}

Write-Host ""
if ($seedExit -eq 0) {
    Write-Host "Done. Local setup restored to SQLite." -ForegroundColor Green
    Write-Host ""
    Write-Host "Next: sign up on the live site with your own email, then make"
    Write-Host "yourself an operator (step 4 on the checklist)."
} else {
    Write-Host "Seeding failed - read the error above. Local setup restored." -ForegroundColor Red
}
