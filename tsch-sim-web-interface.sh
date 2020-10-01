#!/bin/bash

# This file starts the simulator along with the web interface.
# It is meant for UNIX-like operating systems: Linux and macOS.
# For a Windows version, see `tsch-sim-web-windows.bat`.

# start the simulator
./tsch-sim.sh examples/web $* &

sleep 1

# start a web browser
if [ "`uname`" == "Linux" ]; then
    sensible-browser http://localhost:2020
else
    # assume MAC
    open http://localhost:2020
fi
