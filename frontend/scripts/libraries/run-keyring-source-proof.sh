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
make check -j"${LIBRARY_JOBS:-2}"
printf '%s\n' 'PASS dedicated source suite with required actual kernel-keyring coverage'
