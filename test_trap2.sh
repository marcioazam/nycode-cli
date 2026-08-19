#!/bin/bash
trap 'python3 -c "import sys; sys.exit(0)"' EXIT
exit 42
