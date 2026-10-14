@echo off
setlocal
set "VAULT=%~dp0"
echo.
echo  claude-vault setup
echo  ==================
echo.

set "NEEDRESTART="
where node >nul 2>nul || (echo  installing Node.js ... & winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements & set NEEDRESTART=1)
where git  >nul 2>nul || (echo  installing Git ...     & winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements & set NEEDRESTART=1)
where gh   >nul 2>nul || (echo  installing GitHub CLI ... & winget install -e --id GitHub.cli --accept-source-agreements --accept-package-agreements & set NEEDRESTART=1)
set "PATH=%PATH%;%ProgramFiles%\nodejs;%ProgramFiles%\Git\cmd;%ProgramFiles%\GitHub CLI"
where node >nul 2>nul || (echo  Node.js was just installed. Close this window, open a NEW terminal, and run setup.cmd again. & pause & exit /b 1)
where git  >nul 2>nul || (echo  Git was just installed. Close this window, open a NEW terminal, and run setup.cmd again. & pause & exit /b 1)

gh auth status >nul 2>nul || (echo  You need to log into GitHub once. Follow the prompts: & gh auth login)
gh auth status >nul 2>nul || (echo  GitHub login did not complete. Run setup.cmd again. & pause & exit /b 1)

node "%VAULT%vault.mjs" setup
if not errorlevel 1 (pushd "%VAULT%" & gh repo edit --default-branch vault >nul 2>nul & popd)
echo.
if errorlevel 1 (echo  setup did NOT finish. Read the messages above, fix, and run setup.cmd again.) else (echo  Done. Open VS Code; your chats, settings, skills and env files are in place.)
echo.
pause
