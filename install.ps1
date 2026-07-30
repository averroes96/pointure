<#
.SYNOPSIS
ShoeDZ / Pointure — Self-Hosted Setup for Windows

.DESCRIPTION
This script mirrors the install.sh functionality for native Windows environments using PowerShell.
It checks for Docker Desktop, downloads the source code, generates secrets securely,
creates .env.local, and spins up the Docker containers.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File install.ps1
#>

$ErrorActionPreference = "Stop"

function Write-Info($msg)    { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Warn($msg)    { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-ErrorMsg($msg){ Write-Host "[ERR]  $msg" -ForegroundColor Red }

function Exit-WithPause {
    Write-Host ""
    Read-Host "Press Enter to exit..."
    exit 1
}

function Get-RandomHex($length) {
    $bytes = New-Object byte[] ($length / 2)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    return ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLower()
}

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "       ShoeDZ / Pointure — Windows Setup" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# ── Download source code if missing ───────────────────────────────────────────
if (!(Test-Path "docker-compose.local.yml") -or !(Test-Path "backend")) {
    Write-Info "Downloading ShoeDZ source code..."
    $zipPath = "$PWD\main.zip"
    Invoke-WebRequest -Uri "https://github.com/averroes96/pointure/archive/refs/heads/main.zip" -OutFile $zipPath
    Write-Info "Extracting files..."
    Expand-Archive -Path $zipPath -DestinationPath "$PWD" -Force
    Move-Item -Path "$PWD\pointure-main\*" -Destination "$PWD" -Force
    Remove-Item -Path "$PWD\pointure-main" -Recurse -Force
    Remove-Item -Path $zipPath -Force
    Write-Success "Source code downloaded and extracted."
}

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
Write-Info "Checking prerequisites..."

if (!(Get-Command "docker" -ErrorAction SilentlyContinue)) {
    Write-ErrorMsg "Docker is not installed."
    Write-ErrorMsg "Please download and install Docker Desktop for Windows: https://docs.docker.com/desktop/install/windows-install/"
    Exit-WithPause
}

# Check if docker daemon is running
try {
    $null = docker info 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Daemon not running" }
} catch {
    Write-ErrorMsg "Docker Desktop is not running. Please launch Docker Desktop from your Start Menu and try again."
    Exit-WithPause
}

Write-Success "Docker Desktop is running."

# ── 2. Environment file ──────────────────────────────────────────────────────
$envFile = ".env.local"
$composeFile = "docker-compose.local.yml"

if (Test-Path $envFile) {
    Write-Warn "$envFile already exists — skipping generation. Edit it manually if needed."
} else {
    Write-Info "Generating $envFile with secure random secrets..."

    $secretKey = Get-RandomHex 100
    $dbPassword = Get-RandomHex 32
    $redisPassword = Get-RandomHex 32

    Write-Host ""
    Write-Host "Enter your ShoeDZ license key (format: SHDZ-XXXX-XXXX-XXXX)." -ForegroundColor Yellow
    Write-Host "Press Enter to skip — you can activate the license later." -ForegroundColor Yellow
    $licenseKey = Read-Host "License key"
    if ([string]::IsNullOrWhiteSpace($licenseKey)) { $licenseKey = "SHDZ-XXXX-XXXX-XXXX" }

    Write-Host ""
    Write-Host "Enter the public URL of this server (e.g. http://192.168.1.10 or http://localhost)." -ForegroundColor Yellow
    $frontendUrl = Read-Host "Frontend URL [http://localhost]"
    if ([string]::IsNullOrWhiteSpace($frontendUrl)) { $frontendUrl = "http://localhost" }

    Write-Host ""
    Write-Host "Allow access from other devices on your local network (LAN)? [y/N]" -ForegroundColor Yellow
    $lanAccess = Read-Host "LAN Access"
    $bindIp = if ($lanAccess -match "^y$|^Y$") { "0.0.0.0" } else { "127.0.0.1" }

    Write-Host ""
    Write-Host "Which port should the app run on? [80]" -ForegroundColor Yellow
    $httpPort = Read-Host "Port"
    if ([string]::IsNullOrWhiteSpace($httpPort)) { $httpPort = "80" }

    # Parse host for ALLOWED_HOSTS
    $frontendHost = $frontendUrl -replace "^https?://", "" -replace ":\d+.*$", "" -replace "/.*$", ""

    # Read template, replace values, and write out
    $envContent = Get-Content ".env.local.example" -Raw
    $envContent = $envContent -replace "change-me-generate-with-python-secrets-token-hex-50", $secretKey
    $envContent = $envContent -replace "change-me-strong-password", $dbPassword
    $envContent = $envContent -replace "change-me-redis-password", $redisPassword
    $envContent = $envContent -replace "SHDZ-XXXX-XXXX-XXXX", $licenseKey
    
    # Fix regex replacements for URLs
    $envContent = $envContent -replace "DATABASE_URL=postgres://shodz:.*@db", "DATABASE_URL=postgres://shodz:${dbPassword}@db"
    $envContent = $envContent -replace "REDIS_URL=redis://:.*@redis", "REDIS_URL=redis://:${redisPassword}@redis"
    
    # Multi-line match fixing for ALLOWED_HOSTS and CORS
    $envContent = $envContent -replace "(?m)^ALLOWED_HOSTS=.*", "ALLOWED_HOSTS=localhost,127.0.0.1,${frontendHost}"
    $envContent = $envContent -replace "(?m)^CORS_ALLOWED_ORIGINS=.*", "CORS_ALLOWED_ORIGINS=http://localhost,${frontendUrl}"

    # Append custom variables
    $envContent += "`nFRONTEND_URL=$frontendUrl"
    $envContent += "`nBIND_IP=$bindIp"
    $envContent += "`nHTTP_PORT=$httpPort"

    [IO.File]::WriteAllText("$PWD\$envFile", $envContent)
    Write-Success "$envFile created."
}

# ── 3. Build and start containers ────────────────────────────────────────────
Write-Info "Building Docker images (this may take several minutes on first run)..."
docker compose -f $composeFile pull --quiet db redis nginx
docker compose -f $composeFile build --quiet

Write-Info "Starting services..."
docker compose -f $composeFile up -d

Write-Info "Waiting for the database to be ready..."
$maxWait = 60
$waited = 0
$dbReady = $false

while ($waited -lt $maxWait) {
    docker compose -f $composeFile exec -T db pg_isready -U shodz *>$null
    if ($LASTEXITCODE -eq 0) {
        $dbReady = $true
        break
    }
    Start-Sleep -Seconds 2
    $waited += 2
}

if (-not $dbReady) {
    Write-ErrorMsg "Database did not become ready within 60s. Check: docker compose -f $composeFile logs db"
    Exit-WithPause
}
Write-Success "Database is ready."

# ── 4. Migrations & static files ─────────────────────────────────────────────
Write-Info "Running database migrations..."
docker compose -f $composeFile exec -T backend python manage.py migrate --noinput

Write-Info "Collecting static files..."
docker compose -f $composeFile exec -T backend python manage.py collectstatic --noinput --clear *>$null
Write-Success "Migrations and static files done."

# ── 5. License activation ─────────────────────────────────────────────────────
$licenseMatch = Select-String -Path $envFile -Pattern "^LICENSE_KEY=(.*)"
if ($licenseMatch) {
    $envLicenseKey = $licenseMatch.Matches.Groups[1].Value.Trim()
    if ($envLicenseKey -and $envLicenseKey -ne "SHDZ-XXXX-XXXX-XXXX") {
        Write-Info "Activating license key..."
        docker compose -f $composeFile exec -T backend python manage.py activate_license $envLicenseKey *>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "License activated."
        } else {
            Write-Warn "License activation failed — you can retry later."
        }
    }
}

# ── 6. Django admin superuser ─────────────────────────────────────
Write-Host ""
Write-Host "Create a Django admin account for the /admin/ panel? [y/N]" -ForegroundColor Yellow
$createSuper = Read-Host "Create Superuser"
if ($createSuper -match "^y$|^Y$") {
    docker compose -f $composeFile exec backend python manage.py createsuperuser
}

# ── 7. Done ──────────────────────────────────────────────────────────────────
$frontendMatch = Select-String -Path $envFile -Pattern "^FRONTEND_URL=(.*)"
$displayUrl = if ($frontendMatch) { $frontendMatch.Matches.Groups[1].Value.Trim() } else { "http://localhost" }

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Green
Write-Host "  ✓  ShoeDZ is running!" -ForegroundColor Green
Write-Host "" -ForegroundColor Green
Write-Host "  👉 NEXT STEP: open your browser and go to:" -ForegroundColor Green
Write-Host "     $displayUrl/setup" -ForegroundColor Green
Write-Host "" -ForegroundColor Green
Write-Host "  Stop  : docker compose -f docker-compose.local.yml down" -ForegroundColor Green
Write-Host "  Logs  : docker compose -f docker-compose.local.yml logs -f" -ForegroundColor Green
Write-Host "===============================================================" -ForegroundColor Green
Write-Host ""

Write-Host "Press Enter to exit..."
Read-Host
