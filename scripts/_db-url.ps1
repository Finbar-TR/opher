# Shared helper: get the production database URL without ever displaying it.
#
# Read-Host echoes what you type, so the connection string ends up in the
# terminal scrollback - and from there into screenshots and pasted transcripts.
# Read-Host -AsSecureString hides it but cannot handle Ctrl+V, so a paste
# arrives as a single character. Neither is acceptable for a credential.
#
# So: keep it in a git-ignored file, written once. Scripts read it from there
# and it is never echoed again.
#
# Order of preference:
#   1. -DatabaseUrl passed explicitly
#   2. scripts\.db-url          (git-ignored; create with Set-OpherDbUrl)
#   3. $env:OPHER_DB
#   4. Prompt as a last resort, with a warning that it will be visible.

function Get-OpherDbUrlPath {
    Join-Path (Split-Path -Parent $PSCommandPath) ".db-url"
}

function Get-OpherDbUrl {
    param([string]$Explicit)

    if ($Explicit) {
        return $Explicit.Trim().Trim('"').Trim("'").Trim()
    }

    $path = Get-OpherDbUrlPath
    if (Test-Path $path) {
        $fromFile = (Get-Content $path -Raw).Trim().Trim('"').Trim("'").Trim()
        if ($fromFile) {
            Write-Host "Using the saved connection from scripts\.db-url" -ForegroundColor DarkGray
            return $fromFile
        }
    }

    if ($env:OPHER_DB) {
        Write-Host "Using the connection from `$env:OPHER_DB" -ForegroundColor DarkGray
        return $env:OPHER_DB.Trim()
    }

    Write-Host ""
    Write-Host "No saved connection found." -ForegroundColor Yellow
    Write-Host "Save it once so it is never shown on screen again:" -ForegroundColor Yellow
    Write-Host "    .\scripts\save-db-url.ps1" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Or paste it now - WARNING: it will be visible in this window." -ForegroundColor Yellow
    $typed = Read-Host -Prompt "DATABASE_URL"
    return $typed.Trim().Trim('"').Trim("'").Trim()
}

function Assert-PostgresUrl {
    param([string]$Url)

    if ([string]::IsNullOrWhiteSpace($Url)) {
        Write-Host "`nNo connection string. Stopping - nothing was changed." -ForegroundColor Red
        exit 1
    }
    if ($Url -notmatch '^postgres(ql)?://') {
        Write-Host "`nThat does not look like a Postgres URL. Stopping." -ForegroundColor Red
        exit 1
    }
}
