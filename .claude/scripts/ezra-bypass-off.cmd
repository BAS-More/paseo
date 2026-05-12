@echo off
:: ezra-bypass-off.cmd — Turn EZRA hook bypass OFF (re-enable hooks)
setx EZRA_HOOKS_OFF "" >nul 2>&1
set EZRA_HOOKS_OFF=
echo EZRA hooks: ACTIVE (cleared EZRA_HOOKS_OFF)
echo Note: Takes effect in new terminal sessions. Current shell updated.
