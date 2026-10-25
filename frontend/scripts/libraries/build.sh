#!/bin/sh
set -eu
export DEBIAN_FRONTEND=noninteractive DEB_BUILD_MAINT_OPTIONS=hardening=+all
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. /etc/os-release
test "$ID" = debian
test "$VERSION_ID" = 13
(cd "$here" && sha256sum -c SHA256SUMS)
mkdir -p /libraries-work/baseline /out;cd /libraries-work
: > runtime-profile.tsv
for package in libgssapi-krb5-2 libk5crypto3 libkrb5-3 libkrb5support0 libp11-kit0 libelf1t64 libfreetype6;do
 if [ "$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || true)" != installed ];then continue;fi
 dpkg-query -W -f='${Package}\t${Version}\n' "$package" >> runtime-profile.tsv
 mkdir -p "baseline/$package/root" "baseline/$package/control"
 dpkg-query -s "$package" > "baseline/$package/status"
 dpkg-query -L "$package" > "baseline/$package/files"
 while IFS= read -r path;do if [ -f "$path" ] || [ -L "$path" ];then cp -a --parents "$path" "baseline/$package/root/";fi;done < "baseline/$package/files"
 for suffix in preinst postinst prerm postrm triggers conffiles shlibs symbols;do
  path=$(dpkg-query --control-path "$package" "$suffix" 2>/dev/null || true)
  if [ -n "$path" ];then cp -a "$path" "baseline/$package/control/$suffix";fi
 done
done
if [ ! -s runtime-profile.tsv ];then echo 'No existing eligible runtime libraries';exit 0;fi
apt-get update
apt-get install -y --no-install-recommends python3 build-essential dpkg-dev binutils quilt debian-keyring gpgv ca-certificates
python3 "$here/fetch.py" "$here" /libraries-work
python3 "$here/prepare.py" validate /libraries-work
set --
for keyring in /usr/share/keyrings/debian-keyring.gpg /usr/share/keyrings/debian-maintainers.gpg /usr/share/keyrings/debian-role-keys.gpg;do if [ -f "$keyring" ];then set -- "$@" --keyring "$keyring";fi;done
for source in krb5 p11-kit elfutils freetype;do
 dsc=$(python3 "$here/prepare.py" dsc /libraries-work "$source")
 if [ -z "$dsc" ];then continue;fi
 gpgv "$@" "$dsc"
 dependencies=$(python3 "$here/prepare.py" dependencies /libraries-work "$source")
 apt-get satisfy -y --no-install-recommends "$dependencies"
 python3 "$here/prepare.py" prepare /libraries-work "$source"
 # Debian rules preserve original features and execute their actual upstream suite.
 (cd "source-$source" && dpkg-buildpackage -B -us -uc -j"${LIBRARY_JOBS:-2}")
 if [ "$source" = elfutils ];then
  # Stock Debian rules ignore make-check failure; this explicit gate does not.
  (cd source-elfutils && make check -j"${LIBRARY_JOBS:-2}")
 fi
done
python3 "$here/package.py" "$here"
# Compile disposable public-API fixtures using matching baseline API headers.
apt-get install -y --no-install-recommends libkrb5-dev libp11-kit-dev libelf-dev libfreetype-dev pkgconf
for source in krb5 p11 elf freetype;do
 case "$source" in krb5) flags='krb5 krb5-gssapi';;p11) flags=p11-kit-1;;elf) flags=libelf;;freetype) flags=freetype2;;esac
 cc -O2 -UNDEBUG $(pkg-config --cflags $flags) "$here/check-$source.c" $(pkg-config --libs $flags) -o "/out/check-$source"
done
python3 "$here/run-staged.py"
# Final check executes only fixtures for packages present in the original profile.
# Consumer mounts tests and runs check-final.py after installing /out/*.deb.
