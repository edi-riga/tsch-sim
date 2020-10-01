@echo off
rem This file starts the simulator on Microsoft Windows

if "%1"=="" goto no_args

set CONFIG_FILE=%~f1
if exist %CONFIG_FILE%\NUL set CONFIG_FILE=%CONFIG_FILE%\config.json

echo "CONFIG_FILE=%CONFIG_FILE%"
set WORKDIR=%~dp0
cd %WORKDIR%

node --harmony --experimental-modules %NODE_ARGUMENTS% source/main.mjs %CONFIG_FILE%

exit /b %errorlevel%

:no_args
echo Expected at least one argument: configuration file name
exit /b 1
