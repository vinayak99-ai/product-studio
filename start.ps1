# Starts both the backend and frontend, each in its own separate, detached
# console window -- see start-backend.ps1 and start-frontend.ps1 for why
# each is a genuinely independent process rather than a child of this
# script (or of VS Code, if that's what launched this). Close each
# service's window individually whenever you want to stop it; closing this
# script's own window, or VS Code, does not touch either of them.
#
# Usage: .\start.ps1 (from the repo root, or anywhere)

$root = $PSScriptRoot

& (Join-Path $root "start-backend.ps1")
& (Join-Path $root "start-frontend.ps1")
