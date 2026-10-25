#!/bin/sh
# Run in a disposable Debian trixie builder matching final runtime architecture/base.
set -eu
export DEBIAN_FRONTEND=noninteractive DEB_BUILD_MAINT_OPTIONS=hardening=+all
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
(cd "$here" && sha256sum -c SHA256SUMS)
mkdir -p /out /network-work
cd /network-work
# Capture eligibility with dpkg-query before bootstrapping Python/build tools.
: > /network-work/runtime-profile.tsv
for package in curl libcurl4t64 libcurl3t64-gnutls openssh-client openssh-server openssh-sftp-server;do
 if [ "$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || true)" = installed ];then
  dpkg-query -W -f='${Package}\t${Version}\n' "$package" >> /network-work/runtime-profile.tsv
 fi
done
if [ ! -s /network-work/runtime-profile.tsv ];then echo 'No existing eligible runtime packages';exit 0;fi
export RUNTIME_PROFILE_TSV=/network-work/runtime-profile.tsv
apt-get update
apt-get install -y --no-install-recommends python3 dpkg-dev binutils
python3 "$here/package-network.py" snapshot /network-work/baseline.json
python3 - <<'PYBASE'
import json
b=json.load(open("/network-work/baseline.json"))
for name,item in b.items():
 if item.get("curl_version"):print("Frozen original curl CLI:\n"+item["curl_version"],flush=True)
 if item.get("library_capabilities"):print("Frozen original "+name+": "+json.dumps(item["library_capabilities"],sort_keys=True),flush=True)
PYBASE
apt-get update
apt-get install -y --no-install-recommends build-essential dpkg-dev git pkg-config autoconf automake libtool patchelf python3 perl ca-certificates gnupg gpgv libssl-dev libgnutls28-dev libssh2-1-dev libkrb5-dev libldap2-dev libnghttp2-dev libnghttp3-dev libpsl-dev libidn2-dev libbrotli-dev libzstd-dev zlib1g-dev libfido2-dev libedit-dev libev-dev patch openssl librtmp-dev
# BEGIN source-tool-admission
missing_tools=''
for tool in git gpg gpgv autoreconf autoconf autoheader automake aclocal libtoolize m4 make cc cpp pkg-config patch patchelf readelf objdump perl python3 tar openssl dpkg-buildflags dpkg-architecture dpkg-deb dpkg-query dpkg-shlibdeps ar ranlib nm ld install sed awk grep;do
 if ! command -v "$tool" >/dev/null 2>&1;then missing_tools="$missing_tools $tool";fi
done
if [ -n "$missing_tools" ];then printf 'Missing source builder tools:%s\n' "$missing_tools" >&2;exit 1;fi
# END source-tool-admission
server_args=''
if python3 -c 'import json,sys;sys.exit("openssh-server" not in json.load(open("/network-work/baseline.json")))';then
 apt-get install -y --no-install-recommends libpam0g-dev libwrap0-dev libselinux1-dev libaudit-dev libwtmpdb-dev libcrypt-dev
 server_args='--with-pam --with-tcp-wrappers --with-selinux --with-audit=linux --with-wtmpdb --with-4in6 --disable-strip --with-default-path=/usr/local/bin:/usr/bin:/bin:/usr/games --with-superuser-path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin --with-libs=-lcrypt ac_cv_func_mkdtemp=no PATH_PASSWD_PROG=/usr/bin/passwd'
fi
export CFLAGS="$(dpkg-buildflags --get CFLAGS)" CPPFLAGS="$(dpkg-buildflags --get CPPFLAGS)" LDFLAGS="$(dpkg-buildflags --get LDFLAGS)"
triplet=$(dpkg-architecture -qDEB_HOST_MULTIARCH)
jobs=${NETWORK_JOBS:-2}
python3 "$here/fetch-sources.py" "$here" /network-work
mkdir -m 700 -p /network-work/gnupg
export GNUPGHOME=/network-work/gnupg
gpg --batch --import curl-release-key.asc openssh-release-key.asc
python3 "$here/prepare-curl-source.py" "$here" /network-work
gpg --batch --verify openssh-10.6p1.tar.gz.asc openssh-10.6p1.tar.gz
# Native OpenSSL-QUIC was removed in curl8.19. Use the maintained backend.
# Keep its PIC static archives private to the build; retain the original TLS ABI.
mkdir ngtcp2; tar -xf ngtcp2-1.25.0.tar.xz -C ngtcp2 --strip-components=1
cd ngtcp2
./configure --enable-option-checking=fatal --prefix=/network-work/quic --libdir=/network-work/quic/lib --enable-lib-only --enable-static --disable-shared --with-pic --enable-cryptotest --with-openssl --with-gnutls
make -j"$jobs"
make check
make install
# Fail if crypto options were ignored or either requested backend was omitted.
test -f /network-work/quic/lib/libngtcp2.a
test -f /network-work/quic/lib/libngtcp2_crypto_ossl.a
test -f /network-work/quic/lib/libngtcp2_crypto_gnutls.a
# A prefix-valued curl option hides system TLS .pc dependencies in curl8.18.
# Select exact private modules via PATH precedence while preserving native paths.
PKG_CONFIG_PATH=/network-work/quic/lib/pkgconfig python3 "$here/check-quic-pkgconfig.py" /network-work/quic
cd /network-work
for tls in openssl gnutls; do
 cd "$tls"
 if [ "$tls" = gnutls ]; then
  # Debian's established GnuTLS symbol namespace is CURL_GNUTLS_3, not upstream4.
  python3 - <<'PY'
from pathlib import Path
p=Path('configure');s=p.read_text();old='CURL_LIBCURL_VERSIONED_SYMBOLS_SONAME="4"';assert s.count(old)==1;s=s.replace(old,'CURL_LIBCURL_VERSIONED_SYMBOLS_SONAME="3"');p.write_text(s)
PY
  tls_args='--with-gnutls --without-openssl --with-ngtcp2 --with-nghttp3'
 else
  tls_args='--with-openssl --with-ngtcp2 --with-nghttp3'
 fi
 # Match Debian's supported protocol/auth/resolver/compression feature set.
 PKG_CONFIG_PATH=/network-work/quic/lib/pkgconfig ./configure --enable-option-checking=fatal --prefix=/usr --libdir="/usr/lib/$triplet" --disable-static --disable-symbol-hiding --enable-versioned-symbols --enable-threaded-resolver --enable-ntlm --enable-tls-srp --enable-smb --enable-ipfs --with-librtmp --with-lber-lib=lber --with-gssapi=/usr --with-nghttp2 --with-libssh2 --without-libssh --with-ca-path=/etc/ssl/certs --with-ca-bundle=/etc/ssl/certs/ca-certificates.crt $tls_args
 python3 "$here/check-curl-config.py" "$PWD" "$tls"
 make -j"$jobs"
 # Official ordinary HTTP GET regression only; no adversarial input reproductions.
 make test TFLAGS='-n 1'
 make DESTDIR="/network-work/stage-$tls" install
 # Static ngtcp2 must not leak an unresolved shared dependency or build RPATH.
 python3 - "$tls" "$triplet" <<'PYLINK'
import pathlib,subprocess,sys
lib=pathlib.Path('/network-work/stage-'+sys.argv[1]+'/usr/lib/'+sys.argv[2]+'/libcurl.so.4')
dynamic=subprocess.check_output(['readelf','-d',str(lib)],text=True)
assert 'Shared library: [libngtcp2' not in dynamic,dynamic
assert '(RPATH)' not in dynamic and '(RUNPATH)' not in dynamic,dynamic
PYLINK
 cd /network-work
done
# Test-only matching official servers need a newer HTTP3 codec. This static
# fixture dependency never participates in runtime curl configure/link/package.
mkdir nghttp3-fixture; tar -xf nghttp3-1.18.0.tar.xz -C nghttp3-fixture --strip-components=1
cd nghttp3-fixture
./configure --enable-option-checking=fatal --prefix=/network-work/http3-fixture --libdir=/network-work/http3-fixture/lib --enable-lib-only --enable-static --disable-shared --with-pic
make -j"$jobs"
# Upstream tests link private symbols directly. Static-only libtool places these
# objects beside .lo files, not in .libs (the upstream shared-build default).
# Keep every upstream test; override only its object locations for this layout.
test -n "$(find lib -maxdepth 1 -name '*.o' -print -quit)"
test -n "$(find lib/sfparse -maxdepth 1 -name '*.o' -print -quit)"
make check 'main_LDADD=../lib/*.o ../lib/sfparse/*.o' 'main_DEPENDENCIES=../lib/*.o ../lib/sfparse/*.o'
make install
cd /network-work
mkdir ngtcp2-fixture; tar -xf ngtcp2-1.25.0.tar.xz -C ngtcp2-fixture --strip-components=1
cd ngtcp2-fixture
PKG_CONFIG_PATH=/network-work/http3-fixture/lib/pkgconfig ./configure --enable-option-checking=fatal --prefix=/network-work/unused-fixture --enable-static --disable-shared --with-openssl --with-gnutls --with-libnghttp3 --with-libev
# Follow upstream recursive ordering: lib/tests/doc, crypto, third-party,
# examples. The example server links third-party/liburlparse.la as well as
# libngtcp2 and crypto; manual subdirectory builds omit that prerequisite.
make -j"$jobs"
make check
test -x examples/osslserver
test -x examples/gtlsserver
cd /network-work
python3 "$here/check-http3.py"
# Preserve Debian GnuTLS library SONAME and install name without changing application code.
python3 "$here/package-network.py" rename-gnutls /network-work/stage-gnutls
python3 "$here/check-http3.py" --transformed
mkdir openssh; tar -xf openssh-10.6p1.tar.gz -C openssh --strip-components=1
cd openssh
if [ -n "$server_args" ];then
 # Official integrated distro series retains GSSAPI/SELinux monitor numbering.
 while IFS= read -r name;do patch --batch --fuzz=0 -p1 -i "$here/server-debian-patches/$name";done < "$here/server-debian-patches/series"
else
 patch --batch --fuzz=0 -p1 -i "$here/gssapi.patch"
 patch --batch --fuzz=0 -p1 -i "$here/ssh-agent-setgid.patch"
 patch --batch --fuzz=0 -p1 -i "$here/ssh-argv0.patch"
fi
autoreconf -fi
./configure --prefix=/usr --sysconfdir=/etc/ssh --libexecdir=/usr/lib/openssh --with-kerberos5=/usr --with-libedit --with-xauth=/usr/bin/xauth --with-ssl-engine --with-security-key-builtin --with-privsep-path=/run/sshd --with-pid-dir=/run $server_args
make -j"$jobs"
# Upstream ordinary SSH-agent regression. Server payload is packaged only if originally installed.
mkdir -p /run/sshd
getent passwd sshd >/dev/null || useradd --system --no-create-home --home-dir /run/sshd --shell /usr/sbin/nologin sshd
make t-exec LTESTS=agent
make DESTDIR=/network-work/stage-openssh install-nokeys
cd /network-work
python3 "$here/package-network.py" package /network-work/baseline.json
python3 "$here/check-network.py" --staged /network-work
# Final-image test must separately run after dpkg installation, proving loader resolution.
