# Starts the backend in its own new console window, running run_backend.py
# (the Windows-safe launcher -- see that file for why it isn't just plain
# `uvicorn app.main:app --reload`).
#
# That new window is a genuinely separate top-level process, not a child of
# whatever shell runs this script -- closing VS Code, or the terminal you
# launched this from, does not close it. Close the backend's own window
# whenever you want to stop the backend.
#
# Usage: .\start-backend.ps1 (from the repo root, or anywhere -- it locates
# itself via $PSScriptRoot regardless of your current directory)

$root = $PSScriptRoot

Start-Process -FilePath "powershell.exe" `
    -WorkingDirectory $root `
    -ArgumentList "-NoExit", "-Command", "python run_backend.py"
