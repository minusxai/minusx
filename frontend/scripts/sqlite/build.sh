#!/bin/sh
set -eu
recipe=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. /etc/os-release
[ "$ID" = debian ] && [ "$VERSION_ID" = 13 ] || { echo 'Requires Debian 13' >&2; exit 1; }
[ "$(id -u)" = 0 ] || exit 1
mkdir -p /build/sqlite /out
# Consumer profile must describe FINAL runtime before installing build dependencies.
if [ -n "${SQLITE_RUNTIME_PACKAGE_LIST:-}" ]; then
 cp "$SQLITE_RUNTIME_PACKAGE_LIST" /build/sqlite/runtime-package-names
else
 dpkg-query -W -f='${binary:Package}\n' | sed 's/:.*//' | sort -u > /build/sqlite/runtime-package-names
fi
profile=/build/sqlite/runtime-package-names
cp "$profile" /out/sqlite-runtime-package-names
if ! grep -Fxq libsqlite3-0 "$profile"; then
 echo 'SQLite runtime absent; no package introduced' > /out/sqlite-absent-preserved
 exit 0
fi
[ "$(dpkg-query -W -f='${source:Version}' libsqlite3-0)" = '3.46.1-7+deb13u2' ] || { echo 'Unexpected SQLite source version' >&2; exit 1; }
# Freeze actual original ELF and package controls BEFORE installing any tools.
mkdir -p /build/sqlite/original
original_library=
for file in $(dpkg-query -L libsqlite3-0); do
 case "$file" in */libsqlite3.so.0) original_library=$file ;; esac
done
[ -n "$original_library" ] && [ -f "$original_library" ]
cp -L "$original_library" /build/sqlite/original/libsqlite3.so.0
printf '%s\n' "$original_library" > /out/sqlite-baseline-library-path
dpkg-query -W -f='${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\t${Architecture}\n' libsqlite3-0 > /out/sqlite-baseline-package.tsv
sha256sum /build/sqlite/original/libsqlite3.so.0 > /out/sqlite-baseline-library.sha256
cp /build/sqlite/original/libsqlite3.so.0 /out/sqlite-baseline-library.so
apt-get update
apt-get -y --no-install-recommends install python3 patch dpkg-dev binutils build-essential ca-certificates
# Measure FROZEN original bytes, never the post-apt live library path.
nm -D --defined-only /build/sqlite/original/libsqlite3.so.0 > /build/sqlite/baseline-symbols.raw
awk '{print $3}' /build/sqlite/baseline-symbols.raw | sort -u > /out/sqlite-baseline-symbols
test -s /out/sqlite-baseline-symbols
python3 "$recipe/prepare.py" /build/sqlite/cache /build/sqlite/source
source=/build/sqlite/source
apt-get update
apt-get -y --no-install-recommends build-dep --arch-only "$source"
(cd "$source" && dpkg-buildpackage -B -uc -us)
# Original Debian binary-arch ends in dh_builddeb, not clean. Generated header
# and libtool .libs library remain; require them explicitly. No self-dev package.
test -f "$source/sqlite3.h"
test -f "$source/.libs/libsqlite3.so.0"
cc -DSQLITE_ENABLE_SESSION=1 -DSQLITE_ENABLE_PREUPDATE_HOOK=1 -I"$source" "$recipe/check-sqlite.c" /build/sqlite/original/libsqlite3.so.0 -ldl -o /build/sqlite/check-baseline
LD_LIBRARY_PATH=/build/sqlite/original /build/sqlite/check-baseline --options > /build/sqlite/baseline-options.raw
sort /build/sqlite/baseline-options.raw > /out/sqlite-baseline-options
# Debian does not run these session tests automatically. Execute them explicitly.
(cd "$source" && make testfixture)
for test in session9 sessionC session1; do
 (cd "$source" && ./testfixture "ext/session/$test.test") > "/out/sqlite-$test.log" 2>&1
 cat "/out/sqlite-$test.log"
 grep -Eq '^0 errors out of [1-9][0-9]* tests' "/out/sqlite-$test.log"
 grep -Fq 'All memory allocations freed - no leaks' "/out/sqlite-$test.log"
done
# Dynamic native checker must also run against FINAL installed package.
cc -DSQLITE_ENABLE_SESSION=1 -DSQLITE_ENABLE_PREUPDATE_HOOK=1 -I"$source" "$recipe/check-sqlite.c" -L"$source/.libs" -lsqlite3 -ldl -o /out/check-sqlite
LD_LIBRARY_PATH="$source/.libs" /out/check-sqlite
for file in /build/sqlite/*.deb; do
 package=$(dpkg-deb -f "$file" Package)
 if grep -Fxq "$package" "$profile"; then cp "$file" /out/; fi
 if [ "$package" = libsqlite3-0 ]; then
  mkdir -p /build/sqlite/packaged
  dpkg-deb -x "$file" /build/sqlite/packaged
  library=/build/sqlite/packaged$original_library
  test -f "$library"
  sha256sum "$library" | cut -d ' ' -f 1 > /out/sqlite-built-library.sha256
 fi
done
test -s /out/sqlite-built-library.sha256
cp "$recipe/verify.sh" /out/verify-sqlite.sh
cp "$recipe/check-sqlite.c" /out/
cp "$recipe/provenance.json" /out/sqlite-source.json
