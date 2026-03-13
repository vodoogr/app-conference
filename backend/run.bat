@echo off
:: ─── CONFERENCE APP — Launcher ───
:: Usa Node.js portable para ejecutar el servidor

SET NODE_DIR=%~dp0node-portable
SET PATH=%NODE_DIR%;%PATH%

:: Verificar que Node existe
IF NOT EXIST "%NODE_DIR%\node.exe" (
    echo.
    echo ❌ No se encontro Node.js portable en la carpeta "node-portable".
    echo.
    echo  OPCION A: Si ya lo tienes en APP RUTAS, copia la carpeta "node-portable" aqui.
    echo  OPCION B: Ejecuta este comando en PowerShell para descargarlo:
    echo     powershell -ExecutionPolicy Bypass -File setup-node.ps1
    echo.
    pause
    exit /b 1
)

echo.
echo  CONFERENCE APP Backend
echo    Node: %NODE_DIR%\node.exe
echo.

:: Ir a la carpeta del proyecto
cd /d "%~dp0"

:: Instalar dependencias si no existen
IF NOT EXIST "node_modules" (
    echo Instalando dependencias...
    call "%NODE_DIR%\npm.cmd" install
    echo.
)

:: Ejecutar servidor
echo Iniciando servidor...
"%NODE_DIR%\node.exe" app.js
pause
