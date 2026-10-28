#!/bin/sh
# Typed transport retains only generic selected package evidence, never admits it.
set -eu
status=0
sh /checks/prepare-packages.sh "$1" || status=$?
mkdir -p /candidate
if test "$status" != 0 && test -d /out; then
    mkdir /candidate/partial-preparation
    for name in util-linux.deb libmount1.deb mount.deb package-relationship-diagnostics.json source-regression.json wrapper-regression.json idmap-header-regression.json openat-resolve-regression.json source-suite-summary.json evidence-binding.json target-binding.json ubuntu-recovery-authorization.json mount-preparation.json; do
        if test -f "/out/$name" && test ! -L "/out/$name"; then cp "/out/$name" /candidate/partial-preparation/; fi
    done
fi
printf '{"kind":"ubuntu-util-package-transport","status":"unadmitted","exit_code":%s,"candidate_installed":false,"native_qualified":false}\n' "$status" > /candidate/transport-status.json
