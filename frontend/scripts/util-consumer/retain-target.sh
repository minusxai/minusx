#!/bin/sh
# Retain only this transaction's bounded diagnostics, including failure state.
set -eu
test "$#" = 3
checks=$1
inputs=$2
out=$3
status=0
if node "$checks/check-transaction-status.mjs" "$inputs" prepare; then
    sh "$checks/install-target.sh" "$checks" "$inputs" "$out" > /tmp/util-install.stdout 2> /tmp/util-install.stderr || status=$?
else
    status=1
fi
mkdir -p "$out"
for name in util-install.stdout util-install.stderr; do
    if test -f "/tmp/$name"; then cp "/tmp/$name" "$out/$name"; fi
done
for name in prepare-status.json preparation.json plan.json source-target-comparison.json provenance-directories.json; do
    if test -f "$inputs/$name"; then cp "$inputs/$name" "$out/$name"; fi
done
printf '{"kind":"util-target-transaction-transport","status":"transaction-unadmitted","source_compiled":false,"native_qualified":false,"exit_code":%s}\n' "$status" > "$out/transaction-status.json"
if test "$status" -ne 0 && test -f "$out/util-install.stderr"; then cat "$out/util-install.stderr"; fi
