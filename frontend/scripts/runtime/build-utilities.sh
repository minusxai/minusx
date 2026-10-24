#!/bin/sh
# Build and package verified upstream utilities on the caller's exact Debian base.
set -eu
helper_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
helper=$helper_dir/package-utilities.py
fetch() {
  curl --fail --silent --show-error --location --retry 3 "$2" -o "$3"
  printf '%s  %s\n' "$1" "$3" | sha256sum --check
}
export DEB_BUILD_MAINT_OPTIONS=hardening=+all
export CFLAGS="$(dpkg-buildflags --get CFLAGS)"
export CPPFLAGS="$(dpkg-buildflags --get CPPFLAGS)"
export LDFLAGS="$(dpkg-buildflags --get LDFLAGS)"
mkdir -p /out
case "$1" in
coreutils)
  fetch a480198559733e9b3da999e90543ac6f888a2caa544d8d664c5a1f17e528e210 https://ftp.gnu.org/gnu/coreutils/coreutils-9.12.tar.xz /tmp/coreutils.tar.xz
  mkdir /corebuild && tar -xJf /tmp/coreutils.tar.xz --strip-components=1 -C /corebuild
  cd /corebuild
  localedef -i fr_FR -f UTF-8 fr_FR.UTF-8
  FORCE_UNSAFE_CONFIGURE=1 ./configure --prefix=/usr --libexecdir=/usr/libexec --enable-install-program=arch
  make -j2
  # Exercise upstream regression suites, including SIZE_MAX sort offsets and multibyte uniq widths.
  chown -R nobody:nogroup /corebuild
  runuser -u nobody -- make -j2 check TESTS='tests/sort/sort-field-limit.sh tests/sort/sort.pl tests/uniq/uniq.pl tests/uniq/uniq-c-width.sh tests/uniq/uniq-perf.sh'
  make DESTDIR=/corestage install
  PATH=/corestage/usr/bin:$PATH python3 "$helper_dir/check-utilities.py" coreutils
  python3 "$helper" coreutils /corestage /out
  ;;
ncurses)
  fetch 355b4cbbed880b0381a04c46617b7656e362585d52e9cf84a67e2009b749ff11 https://invisible-island.net/archives/ncurses/ncurses-6.6.tar.gz /tmp/ncurses.tar.gz
  mkdir /cursesbuild && tar -xzf /tmp/ncurses.tar.gz --strip-components=1 -C /cursesbuild
  cd /cursesbuild
  ./configure --prefix=/usr --libdir=/usr/lib/$(dpkg-architecture -qDEB_HOST_MULTIARCH) \
    --with-shared --without-normal --without-debug --without-ada --without-cxx-binding \
    --enable-widec --with-termlib=tinfo --with-ticlib=tic --with-versioned-syms \
    --with-abi-version=6 --enable-symlinks --disable-root-access --disable-setuid-environ \
    --with-default-terminfo-dir=/usr/share/terminfo \
    --with-terminfo-dirs='/etc/terminfo:/lib/terminfo:/usr/share/terminfo'
  make -j2
  make DESTDIR=/cursesstage install
  LD_LIBRARY_PATH=/cursesstage/usr/lib/$(dpkg-architecture -qDEB_HOST_MULTIARCH) PATH=/cursesstage/usr/bin:$PATH TERMINFO=/cursesstage/usr/share/terminfo python3 "$helper_dir/check-utilities.py" ncurses
  python3 "$helper" ncurses /cursesstage /out
  ;;
*) echo 'Expected coreutils or ncurses' >&2; exit 1 ;;
esac
