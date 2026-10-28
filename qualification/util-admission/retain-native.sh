#!/bin/sh
# Export bounded technical failure receipts; transport success never admits native.
set -eu
test "$#" = 5
status=0
sh /checks/accept-util-native.sh "$@" || status=$?
mkdir /native-export
for name in nsenter-baseline.json nsenter-candidate.json apt-cache-priming.json dependency-closure.json apt-plan.json final-native.json apt-simulation.txt apt-simulation.stderr dpkg-audit.stdout dpkg-audit.stderr before-packages.tsv; do
    if test -f "/qualification-result/$name"; then
        cp "/qualification-result/$name" /native-export/
    fi
done
cp /inputs/plan.json /native-export/
cp /tool-closure.json /native-export/
printf '{"kind":"util-native-transport","status":"native-unadmitted","native_qualified":false,"exit_code":%s}\n' "$status" > /native-export/native-status.json
