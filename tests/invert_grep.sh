#!/bin/bash

#
# Executes grep and logically inverts the return code
#

grep "$1" $2
RETCODE=$?
if [[ $RETCODE == 0 ]]
then
    exit 1
else
    exit 0
fi
