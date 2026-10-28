#!/bin/sh
# Run INSIDE an isolated hosted source-builder container with narrow test profile.
set -eu
export LC_ALL=C KRB5_REQUIRE_KEYRING_TESTS=1
work=${1:-/libraries-work}
root="$work/source-krb5"
test -f "$root/build/Makefile"
command -v keyctl >/dev/null
# Fail before the suite if this dedicated test boundary still blocks the syscall.
keyctl add user ordinary_source_probe data @p >/dev/null
# All upstream tests, including actual keyring branches, must pass here.
cd "$root/build"
# These suites share the default KDC listener ports across test directories.
# Serialize tests; compilation in the source builder remains parallel.
status=0
make check -j1 || status=$?
if [ "$status" -ne 0 ]; then
    # The host removes this container; retain nested suite diagnostics first.
    find . -type f \( -name testlog -o -name kadmind5.log -o -name others.log -o -name kdc.log \) -exec sh -c '
        for log do
            printf "\nBEGIN_KRB5_FAILURE_DIAGNOSTIC %s\n" "$log"
            cat "$log" || printf "UNREADABLE_KRB5_FAILURE_DIAGNOSTIC %s\n" "$log"
            printf "END_KRB5_FAILURE_DIAGNOSTIC %s\n" "$log"
        done
    ' sh {} + || :
    exit "$status"
fi
printf '%s\n' 'PASS dedicated source suite with required actual kernel-keyring coverage'
