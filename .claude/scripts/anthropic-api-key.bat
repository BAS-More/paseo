@echo off
REM ANTHROPIC_API_KEY helper — pulls live value from claude-vault on demand.
REM
REM Why: keeps the key out of settings.json plaintext (SEC-001 from
REM 2026-04-28 ezra-reviewer audit). Claude Code reads stdout of this
REM script via the `apiKeyHelper` setting and uses it as the API key.
REM
REM Vault entry: claude-proxy/token (sourced via Windows Credential Manager).
REM
REM If vault is locked, run once per day:
REM     python C:/Dev/tools/vault/vault.py unlock 60

setlocal
python C:/Dev/tools/vault/vault.py get claude-proxy token 2>nul
if errorlevel 1 (
  echo [ERROR] anthropic-api-key.bat: vault.py exit %errorlevel%. Vault locked? Run: python C:/Dev/tools/vault/vault.py unlock 60 1>&2
  exit /b 1
)
endlocal
