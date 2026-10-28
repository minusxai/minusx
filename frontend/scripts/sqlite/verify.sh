#!/bin/sh
# Run in final Linux image, with /out artifacts mounted at supplied path.
set -eu
proof=${1:-/out}
unset LD_LIBRARY_PATH LD_PRELOAD
if [ -f "$proof/sqlite-absent-preserved" ]; then
 ! dpkg-query -W -f='${Status}' libsqlite3-0 2>/dev/null | grep -q 'install ok installed'
 exit 0
fi
[ "$(dpkg-query -W -f='${Version}' libsqlite3-0)" = 3.46.1-7+deb13u2+runtime1 ]
library=$(cat "$proof/sqlite-baseline-library-path")
actual=$(sha256sum "$library")
[ "${actual%% *}" = "$(cat "$proof/sqlite-built-library.sha256")" ]
cmp /usr/share/sqlite-runtime/runtime-source.json "$proof/sqlite-source.json"
"$proof/check-sqlite"
"$proof/check-sqlite" --options > /tmp/sqlite-final-options.raw
sort /tmp/sqlite-final-options.raw > /tmp/sqlite-final-options
cmp "$proof/sqlite-baseline-options" /tmp/sqlite-final-options
# Resolve every original exported name; not a complete ABI comparison.
"$proof/check-sqlite" --exports "$proof/sqlite-baseline-symbols"
# Optional already-installed interpreter consumer, never install Python for this.
if command -v python3 >/dev/null; then
 python3 -c 'import sqlite3; c=sqlite3.connect(":memory:"); assert c.execute("select 40+2").fetchone()==(42,); assert sqlite3.sqlite_version=="3.46.1"'
fi
