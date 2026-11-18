@echo off
setlocal
set "PATH=%~dp0..\.tools\node-v26.13.1-win-x64;%~dp0..\.tools\ffmpeg\ffmpeg-9.0.2-essentials_build\bin;%PATH%"
pushd "%~dp0.."
if "%~1"=="install" (
  call npm.cmd install --ignore-scripts --no-audit --no-fund
  if errorlevel 1 exit /b 1
  call npm.cmd ci --prefix apps/discord --ignore-scripts --no-audit --no-fund
) else if "%~1"=="project:init" (
  call npm.cmd run project:init
) else if "%~1"=="persona:apply" (
  call npm.cmd run persona:apply
) else if "%~1"=="persona:reload" (
  call npm.cmd run persona:reload
) else if "%~1"=="dsh:restart" (
  call npm.cmd run dsh:restart
) else if "%~1"=="shutdown" (
  call npm.cmd run shutdown
) else if "%~1"=="startup" (
  call npm.cmd run startup
) else if "%~1"=="bot:status" (
  call npm.cmd run bot:status
) else if "%~1"=="dsh:start" (
  call npm.cmd run dsh:start
) else if "%~1"=="dsh:smoke" (
  call npm.cmd run dsh:smoke
) else if "%~1"=="discord:start" (
  call npm.cmd run discord:start
) else if "%~1"=="test:discord" (
  call npm.cmd run test:discord
) else if "%~1"=="doctor:deployment" (
  call npm.cmd run doctor:deployment
) else if "%~1"=="doctor" (
  call npm.cmd run doctor
) else if "%~1"=="check" (
  call npm.cmd run check
) else (
  echo Usage: scripts\dev.cmd install^|check^|doctor^|doctor:deployment^|project:init^|persona:apply^|persona:reload^|dsh:restart^|startup^|shutdown^|bot:status^|dsh:start^|dsh:smoke^|discord:start^|test:discord
  popd
  exit /b 1
)
set "taskExit=%errorlevel%"
popd
exit /b %taskExit%
