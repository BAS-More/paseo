@echo off
REM GitHub MCP launcher — pulls PAT from vault, never stores it in config.
REM Invoked by claude_desktop_config.json as the `command` for the github MCP.
REM On PAT rotation: `python C:/Dev/tools/vault/vault.py set github pat <new>` — no config edit needed.

setlocal

for /f "usebackq delims=" %%i in (`python "C:/Dev/tools/vault/vault.py" get github pat 2^>nul`) do set "GITHUB_PERSONAL_ACCESS_TOKEN=%%i"

if "%GITHUB_PERSONAL_ACCESS_TOKEN%"=="" (
  echo [mcp-github-launcher] ERROR: no PAT found in vault at github/pat 1>&2
  echo [mcp-github-launcher] Run: python C:/Dev/tools/vault/vault.py set github pat ^<token^> 1>&2
  exit /b 1
)

node "C:/Users/%USERPROFILE%/AppData/Roaming/npm/node_modules/@modelcontextprotocol/server-github/dist/index.js"
endlocal
