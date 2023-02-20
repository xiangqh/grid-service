#!/bin/sh

if [ -f "pid" ];then
    kill -9 `cat pid`
    rm -rf pid
fi

LOGDIR="./log"

current=`date "+%Y-%m-%d"`
logName="app_$current.log"

#echo -n "Enter your key:"
#read -s key
#echo $key > 0

cmd="node dist/main.js"

nohup ${cmd} >> "${LOGDIR}/${logName}" 2>&1 & echo $! > "./pid"