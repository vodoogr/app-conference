# Descarga e instala Node.js portable SIN permisos de admin
# Ejecutar desde PowerShell

$nodeVersion = "v20.11.1"
$nodeFolder  = "node-portable"
$nodeUrl     = "https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-win-x64.zip"
$zipPath     = "$env:TEMP\node-portable.zip"
$extractPath = "$PSScriptRoot\$nodeFolder"

Write-Host "`n🚀 Descargando Node.js $nodeVersion portable..." -ForegroundColor Cyan
Write-Host "   Destino: $extractPath`n"

try {
    # Descargar
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $nodeUrl -OutFile $zipPath
    Write-Host "✅ Descarga completada" -ForegroundColor Green

    # Extraer
    Write-Host "📦 Extrayendo..."
    if (Test-Path $extractPath) { Remove-Item $extractPath -Recurse -Force }
    Expand-Archive -Path $zipPath -DestinationPath $PSScriptRoot -Force

    # Renombrar carpeta
    $extracted = Get-ChildItem $PSScriptRoot -Directory | Where-Object { $_.Name -like "node-*-win-x64" } | Select-Object -First 1
    if ($extracted) {
        Rename-Item $extracted.FullName $nodeFolder
    }

    # Limpiar zip
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

    Write-Host "✅ Node.js portable instalado en: $extractPath" -ForegroundColor Green
    Write-Host "`n📌 Para usar, ejecuta: .\run.bat" -ForegroundColor Yellow
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
}
