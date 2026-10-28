#!/bin/sh
# UNADMITTED REVIEW CANDIDATE. Run only in a separately authorized isolated
# native qualification stage, after externally authenticating all input hashes.
# The resolver Python/tool closure is mounted read-only; never APT-installed here.
set -eu
export PATH=/usr/bin:/bin LC_ALL=C DEBIAN_FRONTEND=noninteractive
unset LD_PRELOAD LD_LIBRARY_PATH PYTHONPATH PYTHONHOME PERL5LIB PERL5OPT GLIBC_TUNABLES
# Caller supplies an immutable, reviewed resolver launcher, not arbitrary shell text.
test "$#" = 5
resolver=$1
checks=$2
inputs=$3
debs=$4
out=$5
test -x "$resolver" && test -d "$checks" && test -d "$inputs" && test -d "$debs"
mkdir -p "$out"
# The qualified original profile is compared before any candidate install.
# Exact status includes every original package, including reverse dependencies.
dpkg-query --admindir=/var/lib/dpkg -W -f='${binary:Package}\t${Version}\t${Status}\n' > "$out/before-packages.tsv"
cp /var/lib/dpkg/status "$out/before-status"
# Closure gate requires raw status SHA from the authenticated pre-APT capture.
"$resolver" "$checks/check-util-closure.py" "$out/before-status" "$inputs/plan.json" "$debs" "$out/dependency-closure.json"
# APT3.0.3 --no-download requires canonical archives already in its cache.
# Copy only these four hash-bound bytes; retain no-download and no-remove.
"$resolver" "$checks/prime-util-apt-cache.py" "$inputs/plan.json" "$debs" /var/cache/apt/archives "$out/apt-cache-priming.json"
# APT sees the actual unmodified runtime state and only these four local files.
apt-get -s --no-download --no-remove --no-install-recommends install \
    "$debs/libmount1.deb" "$debs/util-linux.deb" "$debs/login.deb" "$debs/mount.deb" \
    > "$out/apt-simulation.txt" 2> "$out/apt-simulation.stderr"
test ! -s "$out/apt-simulation.stderr"
"$resolver" "$checks/check-util-apt-plan.py" "$out/apt-simulation.txt" "$inputs/plan.json" > "$out/apt-plan.json"
# Payload/control/source/hash validation and plan checks must have completed in
# the read-only resolver before this explicit four-package transaction.
apt-get -y --no-download --no-remove --no-install-recommends install \
    "$debs/libmount1.deb" "$debs/util-linux.deb" "$debs/login.deb" "$debs/mount.deb"
ldconfig
(cd / && sha256sum -c "$inputs/runtime-payload.sha256")
"$inputs/check-absence.sh" "$inputs/runtime-absent.paths"
"$inputs/check-util-linux"
nsenter -- /usr/bin/true
test "$(nsenter --wd=/tmp -- /usr/bin/pwd)" = /tmp
case "$(unshare --version)" in *'util-linux 2.41.5'*) ;; *) exit 1;; esac
# Metadata-only mount and unchanged providers must retain native bytes+mode+IDs.
"$resolver" "$checks/check-util-final.py" "$inputs/plan.json" "$out/before-status" "$inputs" "$out/final-native.json" "$debs"
apt-get check
audit_status=0
dpkg --audit > "$out/dpkg-audit.stdout" 2> "$out/dpkg-audit.stderr" || audit_status=$?
test "$audit_status" = 0
test ! -s "$out/dpkg-audit.stdout"
test ! -s "$out/dpkg-audit.stderr"
# This script intentionally does not emit an admitted result. The external
# qualification recorder authenticates job, input hashes and every final gate.
