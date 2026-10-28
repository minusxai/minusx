# syntax=docker/dockerfile:1
# Bounded source qualification; build context is frontend, final consumers recheck actual closure.
FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS acl-qualification
RUN apt-get update && apt-get install -y --no-install-recommends build-essential dpkg-dev debhelper \
    gettext libattr1-dev autoconf automake autopoint libtool pkgconf debian-keyring gpgv \
    python3 curl ca-certificates xz-utils attr acl texinfo libselinux1-dev && rm -rf /var/lib/apt/lists/*
RUN cp /usr/bin/tar /original-tar && cp -L /usr/lib/x86_64-linux-gnu/libacl.so.1 /original-libacl.so
COPY scripts/acl /acl-checks
RUN python3 /acl-checks/check-source-status.py && python3 /acl-checks/build-acl.py
RUN dpkg -i /acl-out/libacl1.deb /acl-out/libacl1-dev.deb
RUN python3 - <<'PY'
import subprocess
def symbols(path):
    return {tuple(line.split()[-2:]) for line in subprocess.check_output(['objdump', '-T', path], text=True).splitlines() if len(line.split()) >= 7 and '*UND*' not in line and '*ABS*' not in line}
assert not symbols('/original-libacl.so') - symbols('/usr/lib/x86_64-linux-gnu/libacl.so.1'), 'Original versioned ABI was lost'
PY
RUN curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --retry 3 \
      https://ftp.gnu.org/gnu/tar/tar-1.35.tar.xz -o /tar.tar.xz \
    && echo '4d62ff37342ec7aed748535323930c7cf94acf71c3591882b26a7ea50f3edc16  /tar.tar.xz' | sha256sum --check \
    && mkdir /tarbuild && tar -xJf /tar.tar.xz --strip-components=1 -C /tarbuild
COPY scripts/tar-patches /patches
RUN cd /patches && sha256sum --check SHA256SUMS \
    && python3 -c 'from pathlib import Path; p=Path("."); listed={line.split()[1] for line in (p/"SHA256SUMS").read_text().splitlines()}; assert len(listed)==19 and listed=={x.name for x in p.glob("*.patch")}'
WORKDIR /tarbuild
RUN for patchfile in /patches/*.patch; do patch --batch --fuzz=0 -p1 < "$patchfile" || exit 1; done \
    && patch --batch --fuzz=0 -p1 < /acl-checks/tar-acl-descriptors.patch && autoreconf -v
RUN original_defaults="$(/original-tar --show-defaults)" \
    && original_rmt="$(printf '%s\n' "$original_defaults" | sed -n 's/.*--rmt-command=\([^ ]*\).*/\1/p')" \
    && original_rsh="$(printf '%s\n' "$original_defaults" | sed -n 's/.*--rsh-command=\([^ ]*\).*/\1/p')" \
    && test -n "$original_rmt" && test -n "$original_rsh" \
    && eval "$(dpkg-buildflags --export=sh)" \
    && FORCE_UNSAFE_CONFIGURE=1 ./configure --prefix=/usr --with-lzma='xz --format=lzma' DEFAULT_RMT_DIR="$(dirname "$original_rmt")" RSH="$original_rsh" \
    && make -j2 && chown -R nobody:nogroup /tarbuild && runuser -u nobody -- make check
RUN python3 /acl-checks/check-tar-acl.py --tar /original-tar --expect-vulnerable \
    && python3 /acl-checks/check-tar-acl.py --tar /tarbuild/src/tar
RUN mkdir /qualification-out && cp -a /acl-out/. /qualification-out/ \
    && cp /tarbuild/src/tar /qualification-out/tar \
    && cp /tarbuild/test-suite.log /qualification-out/tar-test-suite.log \
    && cp /acl-source/build/test-suite.log /qualification-out/acl-test-suite.log
RUN python3 - <<'PY'
import hashlib,json,pathlib,re,subprocess
p=pathlib.Path('/tarbuild/config.h')
features={m[1]:int(m[2]) for line in p.read_text().splitlines() if (m:=re.fullmatch(r'#define\s+([A-Z0-9_]*(?:ACL|XATTR)[A-Z0-9_]*)\s+([01])',line))}
symbols=subprocess.check_output(['objdump','-T','/tarbuild/src/tar'],text=True)
imports=sorted({line.split()[-1] for line in symbols.splitlines() if '*UND*' in line and line.split()[-1].startswith('acl_')})
assert {'acl_get_file_at','acl_set_file_at','acl_extended_file_at','acl_delete_def_file_at'} <= set(imports)
assert not {'acl_get_file','acl_set_file','acl_delete_def_file','acl_extended_file'} & set(imports)
pathlib.Path('/qualification-out/caller-proof.json').write_text(json.dumps({'config_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'features':features,'acl_imports':imports},sort_keys=True,indent=2)+'\n')
PY
FROM scratch AS acl-qualification-output
COPY --from=acl-qualification /qualification-out/ /
