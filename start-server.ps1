# Start server in a new window (Windows)
# Usage: Right-click -> Run with PowerShell, or from PowerShell: .\start-server.ps1
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","node server.js" -WorkingDirectory $scriptDir -WindowStyle Normal -NoNewWindow:$false
