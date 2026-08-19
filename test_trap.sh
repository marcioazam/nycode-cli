#!/bin/bash
cleanup() {
    python3 -c 'import sys; sys.exit(0)'
}
trap cleanup EXIT
exit 42
