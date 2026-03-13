@echo off
:: ─── CONFERENCE APP — Tunnel Pro ───
:: Usa Cloudflare Tunnel (mucho mas estable que localtunnel)

SET NODE_DIR=%~dp0node-portable
SET PATH=%NODE_DIR%;%PATH%

echo.
echo  🚀 Creando Tunel Estable con Cloudflare...
echo.

:: Corregido: El paquete en npm es 'cloudflared' (sin el @cloudflare/)
call "%NODE_DIR%\npm.cmd" exec -- cloudflared tunnel --url http://localhost:3000
pause
