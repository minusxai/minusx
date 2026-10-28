#!/bin/sh
# Transport bounded preparation diagnostics; success here never admits output.
set -eu
test "$#" = 4
status=0
/checks/resolver /checks/prepare-target.py "$@" > /tmp/util-prepare.stdout 2> /tmp/util-prepare.stderr || status=$?
mkdir -p /out
cp /tmp/util-prepare.stdout /out/prepare.stdout
cp /tmp/util-prepare.stderr /out/prepare.stderr
printf '{"kind":"util-target-prepare-transport","status":"prepared-unadmitted","source_compiled":false,"native_qualified":false,"exit_code":%s}\n' "$status" > /out/prepare-status.json
if test "$status" -ne 0; then cat /out/prepare.stderr; fi
