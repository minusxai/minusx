#!/bin/sh
# Build the exact Debian source with reviewed upstream security backports.
set -eu
export DEBIAN_FRONTEND=noninteractive LC_ALL=C.UTF-8
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. /etc/os-release
test "$ID" = debian && test "$VERSION_ID" = 13
(cd "$here" && sha256sum -c SHA256SUMS)
mkdir -p /out /util-linux-work /tmp/util-linux-home
cd /util-linux-work
# Freeze the original package-manager omission policy before APT changes.
mkdir -p /out/pristine-package-profile
rm -f /out/pristine-package-profile/dpkg-docker.cfg
if test -f /etc/dpkg/dpkg.cfg.d/docker; then
    cp -p /etc/dpkg/dpkg.cfg.d/docker /out/pristine-package-profile/dpkg-docker.cfg
fi
lintian_excluded=false
if test -f /out/pristine-package-profile/dpkg-docker.cfg \
    && grep -Fxq 'path-exclude /usr/share/lintian/overrides/*' /out/pristine-package-profile/dpkg-docker.cfg; then
    lintian_excluded=true
fi
for package in util-linux libmount1 login; do
    case "$package" in login) expected=1:4.16.0-2+really2.41.5-0+deb13u1;; *) expected=2.41.5-0+deb13u1;; esac
    test "$(dpkg-query -W -f='${Version}' "$package")" = "$expected"
    mkdir -p "original/$package/controls"
    dpkg-query -s "$package" > "original/$package/status"
    dpkg-query -L "$package" > "original/$package/paths"
    # Minimal base images may omit package-listed documentation. Record every
    # absence explicitly; missing runtime/configuration is always an error.
    : > "original/$package/present-paths"
    : > "original/$package/absent-documentation"
    while IFS= read -r path; do
        if test -e "$path" || test -L "$path"; then
            printf '%s\n' "$path" >> "original/$package/present-paths"
        else
            case "$path" in
                /usr/share/doc|/usr/share/doc/*|/usr/share/man|/usr/share/man/*)
                    printf '%s\n' "$path" >> "original/$package/absent-documentation";;
                /usr/share/lintian|/usr/share/lintian/overrides|/usr/share/lintian/overrides/*)
                    if test "$lintian_excluded" = true; then
                        printf '%s\n' "$path" >> "original/$package/absent-documentation"
                    else
                        printf 'Missing original lintian path without exclusion policy: %s\n' "$path" >&2
                        exit 1
                    fi;;
                *) printf 'Missing original runtime path: %s\n' "$path" >&2; exit 1;;
            esac
        fi
    done < "original/$package/paths"
    mkdir -p "/out/pristine-package-profile/$package"
    cp "original/$package/paths" "original/$package/present-paths" \
        "original/$package/absent-documentation" "/out/pristine-package-profile/$package/"
    tar --no-recursion --absolute-names --numeric-owner \
        -cpf "original/$package/payload.tar" \
        --verbatim-files-from --files-from "original/$package/present-paths"
    dpkg-query --control-list "$package" > "original/$package/control-list"
    while IFS= read -r control; do
        case "$control" in
            conffiles|config|md5sums|postinst|postrm|preinst|prerm|shlibs|symbols|templates|triggers) ;;
            list) continue;;
            *) printf 'Unreviewed package control: %s\n' "$control" >&2; exit 1;;
        esac
        location=$(dpkg-query --control-path "$package" "$control")
        cp -p "$location" "original/$package/controls/$control"
    done < "original/$package/control-list"
done
# Retain Debian's Signed-By trust configuration for the source index too.
find /etc/apt/sources.list.d -name '*.sources' -exec sed -i -E \
    's/^(Types:[[:space:]]+deb)([[:space:]]*)$/\1 deb-src\2/' {} +
grep -Rqs '^Types:.*deb-src' /etc/apt/sources.list.d
apt-get update
apt-get install -y --no-install-recommends python3 dpkg-dev quilt binutils
apt-get source --download-only util-linux=2.41.5-0+deb13u1
python3 "$here/prepare.py" "$here" /util-linux-work
apt-get build-dep -y --no-install-recommends util-linux=2.41.5-0+deb13u1
python3 "$here/package.py" snapshot "$here" /util-linux-work
cd /util-linux-work/source
python3 "$here/check-source.py" "$PWD" /out/source-regression.json
chown -R nobody:nogroup /util-linux-work /tmp/util-linux-home
# Preserve the distro's complete build and test targets. No nocheck/profile skip.
if runuser -u nobody -- env HOME=/tmp/util-linux-home \
    DEB_BUILD_PROFILES= DEB_BUILD_OPTIONS=parallel=2 \
    dpkg-buildpackage -b -uc -us -j2 > /out/source-build.log 2>&1; then
    cat /out/source-build.log
else
    cat /out/source-build.log
    exit 1
fi
test -f ../runtime-config.h
python3 "$here/check-idmap-header.py" "$PWD" /out/idmap-header-regression.json ../runtime-config.h
grep -Eq '^#define USE_LIBMOUNT_MOUNTFD_SUPPORT 1$' ../runtime-config.h
! grep -F -- '--disable-libmount-mountfd-support' debian/rules
python3 "$here/check-source.py" "$PWD" /out/source-regression.json --fixtures
cc -O2 -Wall -Wextra -Werror -Ilibmount/src -I/util-linux-work \
    "$here/check-util-linux.c" -L.libs -lmount -o /out/check-util-linux
python3 "$here/package.py" package "$here" /util-linux-work
# Test the actual installed rebuilt packages and normal command interfaces.
dpkg -i /out/libmount1.deb /out/util-linux.deb /out/login.deb
ldconfig
sha256sum -c /out/runtime-payload.sha256
/out/check-absence.sh /out/runtime-absent.paths
/out/check-util-linux
nsenter -- /usr/bin/true
directory=$(nsenter --wd=/tmp -- /usr/bin/pwd)
test "$directory" = /tmp
version=$(unshare --version)
case "$version" in *'util-linux 2.41.5'*) ;; *) exit 1;; esac
apt-get check
audit=$(dpkg --audit 2>&1) || { printf '%s\n' "$audit" >&2; exit 1; }
test -z "$audit" || { printf '%s\n' "$audit" >&2; exit 1; }
