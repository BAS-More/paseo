@echo off
:: ezra-bypass-status.cmd — Check if EZRA hooks are bypassed
if "%EZRA_HOOKS_OFF%"=="1" (
    echo EZRA hooks: BYPASSED (EZRA_HOOKS_OFF=1)
    exit /b 1
) else (
    echo EZRA hooks: ACTIVE
    exit /b 0
)
