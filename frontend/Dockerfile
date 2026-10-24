# syntax=docker/dockerfile:1
# Frontend Dockerfile for MinusX BI - Multi-stage build with standalone mode

# Preserve esbuild's exact JavaScript/binary protocol while rebuilding its Go runtime.
FROM golang:1.27.3-bookworm@sha256:972b4110ba0f47539a975c31e52c64765e1ff19f2d74469ae4a595c6676e80a5 AS esbuild-runtime
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
RUN for version in 0.28.1 0.28.2; do \
      mkdir -p /build/$version /out/$version; cd /build/$version; \
      go mod init build-source \
      && go mod download github.com/evanw/esbuild@v$version \
      && cp -R "$(go env GOPATH)/pkg/mod/github.com/evanw/esbuild@v$version/." . \
      && chmod -R u+w . \
      && go mod edit -require=golang.org/x/sys@v0.44.0 \
      && go mod download golang.org/x/sys \
      && go build -trimpath -ldflags='-s -w' -o /out/$version/esbuild ./cmd/esbuild \
      && test "$(/out/$version/esbuild --version)" = "$version" || exit 1; \
    done

# ===== BUILDER STAGE ===== #
FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS base
COPY scripts/patch-npm.mjs /tmp/patch-npm.mjs
RUN npm install --global --no-audit --no-fund npm@12.2.1 \
    && node /tmp/patch-npm.mjs && npm cache clean --force

FROM base AS pcre2
ENV DEB_BUILD_MAINT_OPTIONS=hardening=+all
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends build-essential pkg-config && rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:929f0b20e62879252a15886b06c89f1edef61a363cbd5826fb041080a5e557ae https://github.com/PCRE2Project/pcre2/releases/download/pcre2-10.49/pcre2-10.49.tar.gz /tmp/pcre2.tar.gz
RUN mkdir /build && tar -xzf /tmp/pcre2.tar.gz --strip-components=1 -C /build
WORKDIR /build
RUN eval "$(dpkg-buildflags --export=sh)" && ./configure --prefix=/usr --libdir=/usr/lib/$(dpkg-architecture -qDEB_HOST_MULTIARCH) --enable-jit --disable-static && make -j2 && make check && make DESTDIR=/stage install
RUN mkdir -p /pkg/DEBIAN /pkg/usr/share/doc/libpcre2-8-0 /pkg/usr/lib/$(dpkg-architecture -qDEB_HOST_MULTIARCH) /out && \
    cp -a /stage/usr/lib/*/libpcre2-8.so.* /pkg/usr/lib/$(dpkg-architecture -qDEB_HOST_MULTIARCH)/ && \
    cp LICENCE.md /pkg/usr/share/doc/libpcre2-8-0/copyright && \
    for control in preinst postinst prerm postrm triggers conffiles; do original="$(dpkg-query --control-path libpcre2-8-0 "$control" 2>/dev/null || true)"; if test -n "$original"; then cp -a "$original" /pkg/DEBIAN/"$control"; fi; done && \
    mkdir -p debian && printf 'Source: pcre2\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\n\nPackage: libpcre2-8-0\nArchitecture: any\nDescription: PCRE2 runtime\n' > debian/control && \
    dependencies="$(dpkg-shlibdeps -O -e$(find /pkg/usr/lib -type f -name 'libpcre2-8.so.*') | sed -n 's/^shlibs:Depends=//p')" && test -n "$dependencies" && \
    original_dependencies="$(dpkg-query -W -f='${Depends}' libpcre2-8-0)" && if test -n "$original_dependencies"; then dependencies="$original_dependencies, $dependencies"; fi && \
    printf 'Package: libpcre2-8-0\nSource: pcre2\nVersion: 10.49-1+runtime1\nArchitecture: %s\nMulti-Arch: same\nSection: libs\nPriority: optional\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\nDepends: %s\nDescription: PCRE2 8-bit runtime built from verified upstream 10.49\n' "$(dpkg --print-architecture)" "$dependencies" > /pkg/DEBIAN/control && \
    original_predepends="$(dpkg-query -W -f='${Pre-Depends}' libpcre2-8-0)" && if test -n "$original_predepends"; then printf 'Pre-Depends: %s\n' "$original_predepends" >> /pkg/DEBIAN/control; fi && \
    dpkg-deb --build --root-owner-group /pkg /out/pcre2.deb

FROM pcre2 AS archive
RUN apt-get update && apt-get install -y --no-install-recommends autoconf automake gettext texinfo libacl1-dev libselinux1-dev attr acl xz-utils && rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:4d62ff37342ec7aed748535323930c7cf94acf71c3591882b26a7ea50f3edc16 https://ftp.gnu.org/gnu/tar/tar-1.35.tar.xz /tmp/tar.tar.xz
COPY scripts/tar-patches /patches
RUN cd /patches && sha256sum -c SHA256SUMS
RUN mkdir /tarbuild && tar -xJf /tmp/tar.tar.xz --strip-components=1 -C /tarbuild
WORKDIR /tarbuild
RUN for patchfile in /patches/*.patch; do patch --batch -p1 < "$patchfile"; done && autoreconf -v
RUN original_defaults="$(tar --show-defaults)" && \
    original_rmt="$(printf '%s\n' "$original_defaults" | sed -n 's/.*--rmt-command=\([^ ]*\).*/\1/p')" && \
    original_rsh="$(printf '%s\n' "$original_defaults" | sed -n 's/.*--rsh-command=\([^ ]*\).*/\1/p')" && \
    test -n "$original_rmt" && test -n "$original_rsh" && \
    eval "$(dpkg-buildflags --export=sh)" && FORCE_UNSAFE_CONFIGURE=1 ./configure --prefix=/usr --with-lzma='xz --format=lzma' DEFAULT_RMT_DIR="$(dirname "$original_rmt")" RSH="$original_rsh" && make -j2 && \
    src/tar --show-defaults | grep -F -- "--rmt-command=$original_rmt" && src/tar --show-defaults | grep -F -- "--rsh-command=$original_rsh"
# Run upstream tests without root so privileged-xattr checks correctly detect unavailable capabilities.
RUN chown -R nobody:nogroup /tarbuild && runuser -u nobody -- make check
RUN mkdir -p /tarpkg/DEBIAN /tarpkg/usr/bin /tarpkg/usr/sbin /tarpkg/usr/share/doc/tar /out && \
    dpkg-query -L tar | while IFS= read -r entry; do if test -f "$entry" || test -L "$entry"; then normalized="$entry"; case "$entry" in /bin/*|/sbin/*|/lib/*|/lib64/*) normalized="/usr$entry";; esac; mkdir -p "$(dirname "/tarpkg$normalized")"; cp -a "$entry" "/tarpkg$normalized"; fi; done && \
    for control in preinst postinst prerm postrm triggers conffiles; do original="$(dpkg-query --control-path tar "$control" 2>/dev/null || true)"; if test -n "$original"; then cp -a "$original" /tarpkg/DEBIAN/"$control"; fi; done && \
    cp src/tar /tarpkg/usr/bin/tar && cp rmt/rmt /tarpkg/usr/sbin/rmt-tar && cp COPYING /tarpkg/usr/share/doc/tar/COPYING.upstream && cp -a /patches /tarpkg/usr/share/doc/tar/patches && \
    mkdir -p debian && printf 'Source: tar\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\n\nPackage: tar\nArchitecture: any\nDescription: GNU tar runtime\n' > debian/control && \
    dependencies="$(dpkg-shlibdeps -O -e/tarpkg/usr/bin/tar -e/tarpkg/usr/sbin/rmt-tar | sed -n 's/^shlibs:Depends=//p')" && test -n "$dependencies" && \
    original_dependencies="$(dpkg-query -W -f='${Depends}' tar)" && if test -n "$original_dependencies"; then dependencies="$original_dependencies, $dependencies"; fi && \
    printf 'Package: tar\nSource: tar\nVersion: 1.35+fedora10-1+runtime1\nArchitecture: %s\nEssential: yes\nSection: utils\nPriority: required\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\nDepends: %s\nDescription: GNU tar with verified Fedora 1.35-10 security backports\n' "$(dpkg --print-architecture)" "$dependencies" > /tarpkg/DEBIAN/control && \
    original_predepends="$(dpkg-query -W -f='${Pre-Depends}' tar)" && if test -n "$original_predepends"; then printf 'Pre-Depends: %s\n' "$original_predepends" >> /tarpkg/DEBIAN/control; fi && dpkg-deb --build --root-owner-group /tarpkg /out/tar.deb

FROM archive AS shell
ADD --checksum=sha256:0d632f6b945058d84809cac7805326775bd60cb4a316907d0bd4228ff7107154 https://git.kernel.org/pub/scm/utils/dash/dash.git/snapshot/dash-0.5.12.tar.gz /tmp/dash.tar.gz
RUN mkdir /shellbuild && tar -xzf /tmp/dash.tar.gz --strip-components=1 -C /shellbuild
WORKDIR /shellbuild
RUN autoreconf -fi && eval "$(dpkg-buildflags --export=sh)" && ./configure --prefix=/usr --enable-fnmatch && make -j2 && nm -D src/dash | grep -w fnmatch
RUN src/dash -c 'set -eu; value=alpha; case "$value" in a*[!0-9]) ;; *) exit 1;; esac; f() { printf "%s" "$1"; }; test "$(f quoted)" = quoted; test "$(printf "%s\n" pipeline | sed s/line//)" = pipe; test "$(printf "\\u20ac")" = "\u20ac"; d=$(mktemp -d); cd "$d"; touch alpha.txt beta.txt; set -- *.txt; test "$#" = 2; test "$1" = alpha.txt'
RUN timeout 5 src/dash -c 'value=$(printf "%050000d" 0 | tr 0 .); case "$value" in *.*.*.*.*.tar.gz) exit 1;; *) printf "libc matcher stress passed\n";; esac'
RUN mkdir -p /shellpkg/DEBIAN /shellpkg/usr/bin /shellpkg/usr/share/doc/dash /out && \
    dpkg-query -L dash | while IFS= read -r entry; do if test -f "$entry" || test -L "$entry"; then normalized="$entry"; case "$entry" in /bin/*|/sbin/*|/lib/*|/lib64/*) normalized="/usr$entry";; esac; mkdir -p "$(dirname "/shellpkg$normalized")"; cp -a "$entry" "/shellpkg$normalized"; fi; done && \
    for control in preinst postinst prerm postrm triggers conffiles; do original="$(dpkg-query --control-path dash "$control" 2>/dev/null || true)"; if test -n "$original"; then cp -a "$original" /shellpkg/DEBIAN/"$control"; fi; done && \
    cp src/dash /shellpkg/usr/bin/dash && cp COPYING /shellpkg/usr/share/doc/dash/COPYING.upstream && \
    mkdir -p debian && printf 'Source: dash\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\n\nPackage: dash\nArchitecture: any\nDescription: POSIX shell with libc matcher\n' > debian/control && \
    dependencies="$(dpkg-shlibdeps -O -e/shellpkg/usr/bin/dash | sed -n 's/^shlibs:Depends=//p')" && test -n "$dependencies" && \
    original_dependencies="$(dpkg-query -W -f='${Depends}' dash)" && if test -n "$original_dependencies"; then dependencies="$original_dependencies, $dependencies"; fi && \
    printf 'Package: dash\nSource: dash\nVersion: 0.5.12+libcfnmatch-1+runtime1\nArchitecture: %s\nEssential: yes\nSection: shells\nPriority: required\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\nDepends: %s\nDescription: Upstream dash 0.5.12 with libc fnmatch enabled\n' "$(dpkg --print-architecture)" "$dependencies" > /shellpkg/DEBIAN/control && \
    original_predepends="$(dpkg-query -W -f='${Pre-Depends}' dash)" && if test -n "$original_predepends"; then printf 'Pre-Depends: %s\n' "$original_predepends" >> /shellpkg/DEBIAN/control; fi && dpkg-deb --build --root-owner-group /shellpkg /out/dash.deb

FROM shell AS utilities
RUN apt-get update && apt-get install -y --no-install-recommends python3 curl ca-certificates locales perl libgmp-dev libattr1-dev libacl1-dev libselinux1-dev bison gperf && rm -rf /var/lib/apt/lists/*
COPY scripts/runtime /runtime-build
RUN sh /runtime-build/build-utilities.sh coreutils && sh /runtime-build/build-utilities.sh ncurses

FROM base AS builder

# Set working directory
WORKDIR /app

# Install dependencies for native modules (better-sqlite3, lightningcss)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and postinstall inputs (needed during npm ci).
# `patches/` MUST be present before `npm ci` so postinstall's patch-package
# applies the pi-ai patch (web search + image-URL support). Without it,
# patch-package silently finds no patches and ships an unpatched pi.
COPY package*.json .npmrc ./
COPY scripts/copy-duckdb-wasm.mjs ./scripts/copy-duckdb-wasm.mjs
COPY patches ./patches

RUN --mount=type=cache,target=/root/.npm \
    npm ci --cache /root/.npm

COPY --from=esbuild-runtime /out /opt/esbuild
COPY scripts/patch-esbuild.mjs /tmp/patch-esbuild.mjs
RUN node /tmp/patch-esbuild.mjs

# Verify the pi-ai patch (web search + image-URL support) was actually applied
# by postinstall. patch-package --error-on-fail silently exits 0 when no patches
# are found, and buildkit can cache an unpatched npm ci layer that silently
# ships broken images. This grep fails the build the instant that happens, so
# we never silently ship an unpatched pi-ai again.
RUN grep -q "MX PATCH" node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js \
    || (echo "ERROR: pi-ai patch not applied — postinstall did not run or patches/ missing at npm ci time" && exit 1)

# Copy application source
COPY . .

# Dummy secret satisfies build-time validation; real value is set at runtime via docker-compose
ENV NEXTAUTH_SECRET=build-placeholder

# Build Next.js application (generates .next/standalone)
# Accept git commit SHA from CI build arg — embedded into the Next.js build by next.config.ts
ARG GIT_COMMIT_SHA
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
ARG NEXT_PUBLIC_DEFAULT_ANALYTICS_CONFIG
ENV NEXT_PUBLIC_DEFAULT_ANALYTICS_CONFIG=$NEXT_PUBLIC_DEFAULT_ANALYTICS_CONFIG
# Sentry auth token (optional) is mounted as a secret so it never lands in an
# image layer; when present, the Sentry plugin uploads source maps during build.
RUN --mount=type=cache,target=/app/.next/cache \
    --mount=type=secret,id=sentry_auth_token \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" npm run build

# Precompile the setup-cli entries (install.sh runs them via `docker run`) to
# plain JS. They must NOT be transpiled at run time: the published image is
# amd64, so on Apple Silicon it runs emulated, and tsx's esbuild service dies
# there ("The service was stopped: write EPIPE") — which silently degraded
# install.sh's LLM/database validation to "no response". Bundling happens here,
# natively on the build host; the container then only runs `node`.
RUN npm run build:setup-cli

# ===== RUNTIME STAGE ===== #
FROM base AS runner

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV BASE_DUCKDB_DATA_PATH=/app
ENV DB_TYPE=pglite
ENV PGLITE_DATA_DIR=/app/data/pglite

# Install curl and ca-certificates for downloading DuckDB files
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=pcre2 /out/pcre2.deb /tmp/pcre2.deb
COPY --from=archive /out/tar.deb /tmp/tar.deb
COPY --from=shell /out/dash.deb /tmp/dash.deb
COPY --from=utilities /out/coreutils.deb /out/libtinfo6.deb /out/ncurses-bin.deb /out/ncurses-base.deb /tmp/runtime-debs/
RUN dpkg --path-include='/usr/share/doc/tar/*' --path-include='/usr/share/doc/dash/*' --path-include='/usr/share/doc/coreutils/*' --path-include='/usr/share/doc/libtinfo6/*' --path-include='/usr/share/doc/ncurses-bin/*' --path-include='/usr/share/doc/ncurses-base/*' -i /tmp/runtime-debs/*.deb /tmp/pcre2.deb /tmp/tar.deb /tmp/dash.deb && rm -rf /tmp/runtime-debs && ldconfig && rm -f /tmp/pcre2.deb /tmp/tar.deb /tmp/dash.deb

# Copy standalone output (much smaller than node_modules - only runtime dependencies)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/.npmrc ./.npmrc
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy database scripts and lib for initialization.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
# Template files are DATA read at boot (lib/templates), not imports, so Next's
# output tracing never sees them — they must be copied explicitly, like scripts/.
COPY --from=builder /app/templates ./templates
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# The precompiled setup-cli (plain JS, no runtime transpile) — install.sh runs
# these with `docker run … node setup-cli/<entry>.js`.
COPY --from=builder /app/setup-cli ./setup-cli

# Install tsx + re-apply pi-ai patches. The npm install restores native deps
# (libduckdb.so) that standalone tracing can't follow, but also overwrites the
# patched pi-ai with the upstream tarball — so patches are re-applied after.
# @tailwindcss/node|oxide + tailwindcss: the story design-system compiler
# (lib/data/story/story-css.server.ts) imports these at RUNTIME (they're
# serverExternalPackages — oxide is a native addon that can't be bundled), so
# standalone tracing misses them; installing here guarantees they exist with
# the right linux native bindings.
COPY --from=builder /app/patches ./patches
# @aws/lambda-invoke-store: aws-sdk transitive that standalone tracing misses.
# The setup-cli bundle keeps node_modules external, so it must resolve here.
# Restore the complete locked production graph: traced directories can omit
# files needed by dynamic imports even when npm sees the correct package version.
RUN rm -rf node_modules \
    && npm ci --omit=dev --ignore-scripts \
    && npm install --omit=dev --ignore-scripts tsx@4.21.0 "@tailwindcss/node@4.2.1" "@tailwindcss/oxide@4.2.1" "tailwindcss@4.2.1" "@aws/lambda-invoke-store@0.2.4"
COPY --from=esbuild-runtime /out /opt/esbuild
COPY scripts/patch-esbuild.mjs /tmp/patch-esbuild.mjs
RUN node /tmp/patch-esbuild.mjs
# npm's runtime reconciliation replaces package files while scripts are disabled.
# Retain the binding compiled against this exact lock and Node ABI in the builder.
COPY --from=builder /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node
RUN npx --yes patch-package@8.0.1 --error-on-fail \
    && rm -rf ./patches && npm cache clean --force
RUN grep -q "MX PATCH" /app/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js \
    || (echo "ERROR: pi-ai patch missing from runtime image" && exit 1)

# Create data directories (docker-compose volumes mount over these; standalone runs use them directly)
RUN mkdir -p /app/data/pglite /app/data/analytics

# Expose frontend port
EXPOSE 3000

CMD ["sh", "-c", "node server.js"]
