#!/bin/sh
# Capture the complete resolver graph before installing any build tools.
# Export technical package metadata only; raw status content is hash-bound.
set -eu
test "$#" = 1
destination=$1
test ! -e "$destination"
mkdir -p "$destination"
export LC_ALL=C PATH=/usr/bin:/bin
sha256sum /var/lib/dpkg/status | cut -d ' ' -f 1 > "$destination/raw-status.sha256"
dpkg-query -W -f='Package: ${Package}\nArchitecture: ${Architecture}\nVersion: ${Version}\nStatus: ${Status}\nSource: ${Source}\nEssential: ${Essential}\nProtected: ${Protected}\nMulti-Arch: ${Multi-Arch}\nPre-Depends: ${Pre-Depends}\nDepends: ${Depends}\nRecommends: ${Recommends}\nSuggests: ${Suggests}\nEnhances: ${Enhances}\nProvides: ${Provides}\nConflicts: ${Conflicts}\nBreaks: ${Breaks}\nReplaces: ${Replaces}\n\n' > "$destination/resolver-status"
dpkg-query -W -f='${Package}\t${source:Package}\t${source:Version}\t${Version}\t${db:Status-Status}\t${Architecture}\n' > "$destination/package-source-map"
dpkg --print-architecture > "$destination/architecture"
dpkg --print-foreign-architectures > "$destination/foreign-architectures"
# The installed source-family list is an admission input, never a request to
# install every binary built from the source package.
awk -F '\t' -v architecture="$(cat "$destination/architecture")" \
    '$2 == "util-linux" && $5 == "installed" {if ($6 != architecture && $6 != "all") exit 1; print $1}' \
    "$destination/package-source-map" > "$destination/installed-util-family"
test -s "$destination/resolver-status"
test -s "$destination/installed-util-family"
sha256sum /var/lib/dpkg/status | cut -d ' ' -f 1 > "$destination/raw-status-after.sha256"
cmp "$destination/raw-status.sha256" "$destination/raw-status-after.sha256"
rm "$destination/raw-status-after.sha256"
