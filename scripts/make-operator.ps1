# Promotes an existing account to operator on a production database.
# Sign up on the live site FIRST, then run this with that email address.
#
# Usage:  .\scripts\make-operator.ps1
#     or: .\scripts\make-operator.ps1 -DatabaseUrl "postgresql://..." -Email "you@example.com"

param(
    [string]$DatabaseUrl,
    [string]$Email
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

. (Join-Path $PSScriptRoot "_db-url.ps1")

Write-Host ""
Write-Host "Make an account an operator" -ForegroundColor Cyan
Write-Host "---------------------------"
Write-Host "The account must already exist - sign up on the live site first."
Write-Host ""

$url = Get-OpherDbUrl -Explicit $DatabaseUrl
Assert-PostgresUrl $url


$mail = if ($Email) { $Email } else { Read-Host -Prompt "Email address" }
$mail = $mail.Trim().Trim('"').Trim("'").Trim()

if ($mail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
    Write-Host "`nThat does not look like an email address. Stopping." -ForegroundColor Red
    exit 1
}

$env:DATABASE_URL = $url
$env:OPERATOR_EMAIL = $mail

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
    npx tsx scripts/make-operator.ts
    $exit = $LASTEXITCODE
}
finally {
    git checkout --quiet prisma/schema.prisma
    npx prisma generate | Out-Null
    $env:DATABASE_URL = $null
    $env:OPERATOR_EMAIL = $null
}

Write-Host ""
if ($exit -eq 0) {
    Write-Host "Local setup restored to SQLite." -ForegroundColor Green
} else {
    Write-Host "Did not work - read the message above. Local setup restored." -ForegroundColor Red
}
