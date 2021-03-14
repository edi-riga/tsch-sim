#!/bin/bash

# This file starts the simulator on UNIX-like operating systems: Linux and macOS
# For a Windows version, see `tsch-sim-windows.bat`.

if [ "$#" -lt 1 ]; then
    echo "Expected at least one argument: configuration file name"
    exit 1
fi

CONFIG_FILE=$(realpath "$1")
if [ -d "$CONFIG_FILE" ] ; then
    CONFIG_FILE=$CONFIG_FILE/config.json
fi
shift

cd `dirname $0`

if command -v nodejs &> /dev/null
then
    NODE=nodejs
else
    NODE=node
fi

$NODE --harmony --experimental-modules $NODE_ARGUMENTS source/main.mjs $CONFIG_FILE $*
