#!/bin/sh
# Only the independently prepared exact four-package plan is installed here.
set -eu
export PATH=/usr/bin:/bin LC_ALL=C DEBIAN_FRONTEND=noninteractive
unset LD_PRELOAD LD_LIBRARY_PATH PYTHONPATH PYTHONHOME PERL5LIB PERL5OPT GLIBC_TUNABLES
test "$#" = 3
checks=$1
inputs=$2
out=$3
mkdir "$out"
cp /var/lib/dpkg/status "$out/before-status"
cmp "$out/before-status" "$inputs/original-status"
resolver="$checks/resolver"
"$resolver" "$checks/check-util-closure.py" "$out/before-status" "$inputs/plan.json" "$inputs/packages" "$out/dependency-closure.json"
"$resolver" "$checks/prime-util-apt-cache.py" "$inputs/plan.json" "$inputs/packages" /var/cache/apt/archives "$out/apt-cache-priming.json"
apt-get -s --no-download --no-remove --no-install-recommends install \
    "$inputs/packages/libmount1.deb" "$inputs/packages/util-linux.deb" "$inputs/packages/login.deb" "$inputs/packages/mount.deb" \
    > "$out/apt-simulation.txt" 2> "$out/apt-simulation.stderr"
test ! -s "$out/apt-simulation.stderr"
"$resolver" "$checks/check-util-apt-plan.py" "$out/apt-simulation.txt" "$inputs/plan.json" > "$out/apt-plan.json"
apt-get -y --no-download --no-remove --no-install-recommends install \
    "$inputs/packages/libmount1.deb" "$inputs/packages/util-linux.deb" "$inputs/packages/login.deb" "$inputs/packages/mount.deb"
/usr/sbin/ldconfig
(cd / && sha256sum -c "$inputs/runtime-payload.sha256")
"$inputs/check-absence.sh" "$inputs/runtime-absent.paths"
"$resolver" "$checks/check-provenance-directories.py" "$inputs" "$out/provenance-directory-check.json"
"$inputs/check-util-linux"
"$resolver" "$checks/capture-util-controls.py" "$inputs/plan.json" "$inputs/packages" "$out/control-observation.json"
"$resolver" "$checks/check-util-final.py" "$inputs/plan.json" "$out/before-status" "$inputs" "$out/final-native.json" "$inputs/packages"
apt-get check
dpkg --audit > "$out/dpkg-audit.stdout" 2> "$out/dpkg-audit.stderr"
test ! -s "$out/dpkg-audit.stdout"
test ! -s "$out/dpkg-audit.stderr"
cp /var/lib/dpkg/status "$out/after-status"
