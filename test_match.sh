#!/bin/bash
line="+++ i;"
if [[ "${line}" == +++[[:space:]]* ]]; then
    echo "MATCHES"
else
    echo "NO MATCH"
fi
