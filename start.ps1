# Starts both the backend and frontend, each in its own separate, detached
# console window -- each is a genuinely independent process rather than a
# child of this script (or of VS Code, if that's what launched this). Close
# each service's window individually whenever you want to stop it; closing
# this script's own window, or VS Code, does not touch either of them.
#
# The backend runs through backend\.venv (created here on first run, with
# its dependencies installed from backend\requirements.txt) instead of
# whatever "python" happens to resolve to on PATH. This machine also has
# other, unrelated Python projects sharing that global interpreter, and
# backend/requirements.txt pins versions (e.g. chromadb) those other
# projects don't -- installing straight into the global site-packages
# fights their pins instead of staying isolated from them.
#
# Usage: .\start.ps1 (from the repo root, or anywhere -- it locates itself
# via $PSScriptRoot regardless of your current directory)

$root = $PSScriptRoot
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"
$venvDir = Join-Path $backendDir ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "backend\.venv not found -- creating it and installing dependencies (first run only, this may take a minute)..."
    python -m venv $venvDir
    & $venvPython -m pip install --quiet --upgrade pip
    & $venvPython -m pip install --quiet -r (Join-Path $backendDir "requirements.txt")
    Write-Host "backend\.venv ready."
}

# Runs run_backend.py (the Windows-safe launcher -- see that file for why
# it isn't just plain `uvicorn app.main:app --reload`) with the venv's
# interpreter, from the repo root so its own relative paths resolve.
Start-Process -FilePath "powershell.exe" `
    -WorkingDirectory $root `
    -ArgumentList "-NoExit", "-Command", "& '$venvPython' run_backend.py"

Start-Process -FilePath "powershell.exe" `
    -WorkingDirectory $frontendDir `
    -ArgumentList "-NoExit", "-Command", "npm run dev"
