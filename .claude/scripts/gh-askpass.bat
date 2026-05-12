@echo off
REM GIT_ASKPASS helper — bridges git's credential prompts to `gh auth token`.
REM
REM Why: the native `git credential-manager` hangs silently (exit 128, no
REM stderr) in non-interactive Claude Code bash sessions. `gh auth setup-git`
REM configures gh as a credential.helper, but git's subprocess invocation of
REM that helper ALSO fails silently in the same environment. This askpass
REM path bypasses both chains — git calls this .bat directly with a prompt
REM string, we answer with static-user + dynamic-token.
REM
REM Usage: set GIT_ASKPASS=%USERPROFILE%\.claude\scripts\gh-askpass.bat
REM Registered globally via ~/.claude/settings.json -> env.GIT_ASKPASS
REM
REM Behavior:
REM   Username prompt  -> x-access-token  (GitHub's bearer-token username)
REM   Password prompt  -> `gh auth token` stdout (fresh every call)
REM   Other prompts    -> token (safer default than empty)

setlocal enabledelayedexpansion

set "PROMPT=%~1"
echo !PROMPT! | findstr /I "Username" >nul
if %ERRORLEVEL%==0 (
    echo x-access-token
    exit /b 0
)

REM Password or unknown — resolve gh.exe and emit the token.
set "GH_EXE=C:\Program Files\GitHub CLI\gh.exe"
if not exist "%GH_EXE%" (
    where gh >nul 2>nul
    if %ERRORLEVEL%==0 (
        for /f "delims=" %%t in ('gh auth token 2^>nul') do (
            echo %%t
            exit /b 0
        )
    )
    REM No gh available — fail clean so git surfaces a real error.
    exit /b 1
)

for /f "delims=" %%t in ('"%GH_EXE%" auth token 2^>nul') do (
    echo %%t
    exit /b 0
)

exit /b 1
