@echo off
REM ── One-click update for the live site (bill-of-material.tail46aa96.ts.net) ──
REM Rebuilds the frontend and restarts the backend after you edit code.
cd /d D:\bom

echo.
echo [1/2] Building frontend (npm run build)...
call npm run build
if errorlevel 1 (
  echo.
  echo *** BUILD FAILED — fix the error above, site NOT updated. ***
  pause
  exit /b 1
)

echo.
echo [2/2] Restarting backend (pm2)...
cd backend
call npx pm2 restart bom-backend --update-env

echo.
echo ============================================================
echo  DONE. Now hard-refresh the browser:  Ctrl + Shift + R
echo  https://bill-of-material.tail46aa96.ts.net/
echo ============================================================
pause
