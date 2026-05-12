@echo off
:: ezra-bypass-on.cmd — Turn EZRA hook bypass ON (current session)
setx EZRA_HOOKS_OFF 1 >nul 2>&1
set EZRA_HOOKS_OFF=1
echo EZRA hooks: BYPASSED (set EZRA_HOOKS_OFF=1)
echo Note: Takes effect in new terminal sessions. Current shell updated.
