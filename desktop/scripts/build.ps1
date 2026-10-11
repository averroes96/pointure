# ShoeDZ Desktop Distribution Build Script (Windows 10/11 x64)
# Automates frontend compilation, embedded Python bundling, and NSIS installer generation.

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\..\.."
$DesktopDir = "$ProjectRoot\desktop"
$BackendDir = "$ProjectRoot\backend"
$FrontendDir = "$ProjectRoot\frontend"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "    ShoeDZ Desktop Distribution Builder (x64 NSIS)        " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# ── 1. Build React Frontend ───────────────────────────────────────────
Write-Host "`n[1/4] Building React Frontend..." -ForegroundColor Yellow
Push-Location $FrontendDir
try {
    if (-not (Test-Path "node_modules")) {
        npm ci
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

    $SpaDest = "$BackendDir\static\spa"
    if (Test-Path $SpaDest) { Remove-Item $SpaDest -Recurse -Force }
    New-Item -ItemType Directory -Path $SpaDest | Out-Null
    Copy-Item -Path "dist\*" -Destination $SpaDest -Recurse -Force
    Write-Host "Frontend build copied to: $SpaDest" -ForegroundColor Green
} finally {
    Pop-Location
}

# ── 2. Bundle Embedded Python 3.12 ───────────────────────────────────
Write-Host "`n[2/4] Setting up Embedded Python 3.12..." -ForegroundColor Yellow
$PythonDist = "$DesktopDir\python-dist"
$PythonZipUrl = "https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip"
$PythonZipPath = "$DesktopDir\python-3.12.7-embed-amd64.zip"

if (-not (Test-Path $PythonDist)) {
    New-Item -ItemType Directory -Path $PythonDist | Out-Null
    if (-not (Test-Path $PythonZipPath)) {
        Write-Host "Downloading Python 3.12 embedded runtime..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $PythonZipUrl -OutFile $PythonZipPath
    }
    Write-Host "Extracting Python runtime..." -ForegroundColor Cyan
    Expand-Archive -Path $PythonZipPath -DestinationPath $PythonDist -Force

    # Enable 'import site' in python312._pth to allow site-packages
    $PthFile = Get-ChildItem "$PythonDist\*._pth" | Select-Object -First 1
    if ($PthFile) {
        $PthContent = Get-Content $PthFile.FullName
        $PthContent = $PthContent -replace "#import site", "import site"
        $PthContent += "`nLib\site-packages"
        $PthContent += "`n..\backend"
        $PthContent += "`n..\python"
        Set-Content -Path $PthFile.FullName -Value $PthContent
    }

    # Install pip and requirements
    Write-Host "Bootstrapping pip and installing desktop requirements..." -ForegroundColor Cyan
    $GetPipPath = "$DesktopDir\get-pip.py"
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $GetPipPath
    & "$PythonDist\python.exe" $GetPipPath --no-warn-script-location
    Remove-Item $GetPipPath -Force

    & "$PythonDist\python.exe" -m pip install --no-warn-script-location -r "$BackendDir\requirements-desktop.txt"
}

# Copy shodz_desktop package into Python dist
$DestShodz = "$PythonDist\shodz_desktop"
if (Test-Path $DestShodz) { Remove-Item $DestShodz -Recurse -Force }
Copy-Item -Path "$DesktopDir\python\shodz_desktop" -Destination $DestShodz -Recurse -Force

# ── 3. Bytecode Compilation ───────────────────────────────────────────
Write-Host "`n[3/4] Pre-compiling Python bytecode..." -ForegroundColor Yellow
& "$PythonDist\python.exe" -m compileall -b "$BackendDir\apps" "$BackendDir\config"

# ── 4. Package NSIS Installer with electron-builder ───────────────────
Write-Host "`n[4/4] Packaging Electron Desktop Installer..." -ForegroundColor Yellow
Push-Location $DesktopDir
try {
    if (-not (Test-Path "node_modules")) {
        npm ci
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
} finally {
    Pop-Location
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host " Build Complete!" -ForegroundColor Green
Write-Host " Installer generated in: desktop\dist\ShoeDZ-Setup-*.exe" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
