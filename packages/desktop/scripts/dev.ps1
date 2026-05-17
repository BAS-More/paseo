$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = (Resolve-Path "$ScriptDir\..").Path
$AppDir = (Resolve-Path "$DesktopDir\..\app").Path
$RootDir = (Resolve-Path "$DesktopDir\..\..").Path

# Build the Electron main process
npm run build:main

# Prefer Metro's stable default port so dev browser storage keeps the same
# localhost origin across restarts. Fall back only when earlier ports are busy.
$env:EXPO_PORT = (npx get-port-cli 8081 8082 8083 8084 8085).Trim()

# Set env vars for child processes. concurrently spawns cmd.exe subshells on
# Windows so PowerShell $env: syntax won't work inline. Setting them in the
# parent lets all children inherit them.
$env:EXPO_DEV_URL = "http://localhost:$($env:EXPO_PORT)"
$env:PASEO_WEB_PLATFORM = "electron"

$RemoteDebuggingPort = if ($env:PASEO_ELECTRON_REMOTE_DEBUGGING_PORT) {
    $env:PASEO_ELECTRON_REMOTE_DEBUGGING_PORT
} else {
    "9223"
}
$ExistingElectronFlags = if ($env:PASEO_ELECTRON_FLAGS) {
    "$($env:PASEO_ELECTRON_FLAGS) "
} else {
    ""
}
$env:PASEO_ELECTRON_FLAGS = "$($ExistingElectronFlags)--remote-debugging-port=$RemoteDebuggingPort"

# Allow any origin in dev so Electron on random ports works.
# SECURITY: wildcard CORS is unsafe in production — only acceptable here because
# the daemon binds to localhost and this script is never used for production.
$env:PASEO_CORS_ORIGINS = "*"

Write-Host @"
======================================================
  Paseo Desktop Dev (Windows)
======================================================
  Metro:     http://localhost:$($env:EXPO_PORT)
  CDP:       http://127.0.0.1:$RemoteDebuggingPort
======================================================
"@

# Launch Metro + Electron together, kill both on exit.
# concurrently spawns cmd.exe subshells on Windows, so env vars must be set
# in the parent process (above) rather than inline with $env: syntax.
& npx concurrently `
    --kill-others `
    --names "metro,electron" `
    --prefix-colors "magenta,cyan" `
    "cd /d `"$AppDir`" && npx expo start --port $($env:EXPO_PORT)" `
    "npx wait-on tcp:$($env:EXPO_PORT) && npx electron `"$DesktopDir`""
