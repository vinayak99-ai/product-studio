# Starts the frontend (Vite dev server) in its own new console window.
# Same detachment as start-backend.ps1: that window is a genuinely separate
# top-level process, not a child of whatever shell runs this script -- see
# start-backend.ps1's comments for why. Close the frontend's own window
# whenever you want to stop it.
#
# Usage: .\start-frontend.ps1 (from the repo root, or anywhere)

$root = Join-Path $PSScriptRoot "frontend"

Start-Process -FilePath "powershell.exe" `
    -WorkingDirectory $root `
    -ArgumentList "-NoExit", "-Command", "npm run dev"
