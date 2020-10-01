@echo off
rem This file starts the simulator along with the web interface.
rem It is meant for Microsoft Windows

rem start the simulator
start tsch-sim-windows.bat examples\web

rem start the default web browser
start http://localhost:2020
