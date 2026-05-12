@echo off
REM Graphiti MCP launcher — pulls OPENAI_API_KEY + FalkorDB credentials from claude-vault.
REM
REM Why: keeps secrets out of .mcp.json plaintext. MCP server inherits env from this wrapper.
REM
REM Vault entries:
REM   graphiti/openai_api_key
REM   graphiti/falkordb_uri        (full redis://user:pwd@host:port)
REM   graphiti/falkordb_password
REM
REM If vault is locked, run once per day:
REM     python C:/Dev/tools/vault/vault.py unlock 60

setlocal
for /f "delims=" %%K in ('python C:/Dev/tools/vault/vault.py get graphiti openai_api_key 2^>nul') do set OPENAI_API_KEY=%%K
if not defined OPENAI_API_KEY (
  echo [ERROR] graphiti-launcher.bat: vault.py exit on openai_api_key. Vault locked? Run: python C:/Dev/tools/vault/vault.py unlock 60 1>&2
  exit /b 1
)

for /f "delims=" %%K in ('python C:/Dev/tools/vault/vault.py get graphiti falkordb_uri 2^>nul') do set FALKORDB_URI=%%K
if not defined FALKORDB_URI (
  echo [ERROR] graphiti-launcher.bat: vault.py exit on falkordb_uri. 1>&2
  exit /b 1
)

for /f "delims=" %%K in ('python C:/Dev/tools/vault/vault.py get graphiti falkordb_password 2^>nul') do set FALKORDB_PASSWORD=%%K
if not defined FALKORDB_PASSWORD (
  echo [ERROR] graphiti-launcher.bat: vault.py exit on falkordb_password. 1>&2
  exit /b 1
)

set GRAPHITI_TELEMETRY_ENABLED=false
uv run --directory "C:/Dev/tools/graphiti/mcp_server" main.py --transport stdio
endlocal
