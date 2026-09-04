# Applies the current Prisma schema to a production database, safely.
#
# The four-command version of this is easy to get wrong in one specific way:
# if DATABASE_URL is not actually set, select-prisma-provider falls back to the
# .env file, picks SQLite, and `prisma db push` silently rewrites your LOCAL
# dev.db instead of production - reporting success the whole way. This script
# refuses to continue unless the provider really flipped to postgresql.
#
# Usage:  .\scripts\migrate-production.ps1
# The connection string comes from scripts\.db-url (git-ignored), so it is never
# displayed. Save it once with .\scripts\save-db-url.ps1.

param(
    [string]$DatabaseUrl,

    # Wipes the database completely, then recreates it from the schema.
    # Needed when existing rows cannot satisfy new required columns - Prisma
    # refuses an in-place change in that case, which is the correct default.
    # Guarded by its own, deliberately awkward confirmation below.
    [switch]$ForceReset
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

. (Join-Path $PSScriptRoot "_db-url.ps1")

Write-Host ""
Write-Host "Apply the schema to a production database" -ForegroundColor Cyan
Write-Host "-----------------------------------------"
Write-Host ""

$url = Get-OpherDbUrl -Explicit $DatabaseUrl
Assert-PostgresUrl $url

$env:DATABASE_URL = $url

# --- Select the provider, then PROVE it took -------------------------------
Write-Host "`nSelecting the database provider..." -ForegroundColor Cyan
node scripts/select-prisma-provider.mjs

$schema = Get-Content "prisma/schema.prisma" -Raw
if ($schema -notmatch 'provider\s*=\s*"postgresql"') {
    Write-Host "`nSTOPPED. The schema is still not set to postgresql." -ForegroundColor Red
    Write-Host "Nothing was changed. This is the failure mode this script exists to catch:"
    Write-Host "continuing here would have rewritten your local dev database instead."
    git checkout --quiet prisma/schema.prisma
    exit 1
}
Write-Host "Confirmed: schema is set to postgresql." -ForegroundColor Green

# Everything from here runs inside try/finally so the local checkout is ALWAYS
# restored - including if you cancel, or the run fails partway. Without this, an
# interruption leaves schema.prisma pointing at postgresql and the next ordinary
# `npm run dev` quietly talks to the wrong database.
$pushExit = 1
try {
    # --- Show what we are about to touch ------------------------------------
    # Host only. Never print the credentials.
    $dbHost = ($url -replace '^postgres(ql)?://', '') -replace '^[^@]*@', '' -replace '/.*$', ''
    Write-Host ""

    if ($ForceReset) {
        Write-Host "About to ERASE AND REBUILD the database at:" -ForegroundColor Red
        Write-Host "  $dbHost" -ForegroundColor Red
        Write-Host ""
        Write-Host "EVERY table, row and account in it will be deleted." -ForegroundColor Red
        Write-Host "This cannot be undone. Only do this on a database whose" -ForegroundColor Red
        Write-Host "contents you are certain you do not need." -ForegroundColor Red
        $expected = "erase everything"
    } else {
        Write-Host "About to apply the schema to: $dbHost" -ForegroundColor Yellow
        Write-Host "This DROPS any table no longer in the schema, and its contents." -ForegroundColor Yellow
        $expected = "apply"
    }

    $confirm = Read-Host "`nType '$expected' to continue"

    if ($confirm -ne $expected) {
        Write-Host "`nCancelled. Nothing was changed." -ForegroundColor Yellow
        return
    }

    # --skip-generate avoids the EPERM file-lock on the Windows query-engine DLL
    # that a stale node process holds. Generating the client is a local concern
    # and has nothing to do with applying the schema.
    Write-Host "`nApplying..." -ForegroundColor Cyan
    if ($ForceReset) {
        npx prisma db push --skip-generate --force-reset
    } else {
        npx prisma db push --skip-generate --accept-data-loss
    }
    $pushExit = $LASTEXITCODE
}
finally {
    git checkout --quiet prisma/schema.prisma
    $env:DATABASE_URL = $null
}

if ($confirm -ne $expected) { exit 0 }

Write-Host ""
if ($pushExit -eq 0) {
    Write-Host "Done. The live database now matches the app." -ForegroundColor Green
    Write-Host "Your local setup has been restored to SQLite for everyday work."
    Write-Host ""
    Write-Host "Next: add your cities with" -NoNewline
    Write-Host "  .\scripts\seed-cities.ps1" -ForegroundColor Cyan
} else {
    Write-Host "The schema was NOT applied - prisma exited with code $pushExit." -ForegroundColor Red
    Write-Host "Your local setup has been restored. Read the error above before retrying."
}
