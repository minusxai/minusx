# Cheap compiler/resolver diagnostic only: no util C source build or installation.
FROM ubuntu:26.10@sha256:93e29beff5257b2cdf1c024d831f6d2997e53655a653ff76a811fc9e6564a719 AS diagnostic
ENV DEBIAN_FRONTEND=noninteractive LC_ALL=C
RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 dpkg-dev quilt ca-certificates libc6-dev=2.44-1ubuntu2
COPY recipe /recipe
COPY diagnostics /checks
RUN echo '339b3d2b35c2ed97b24d81642deac2da23d422f5f2e6b8cc51b0842eac5a2f3e  /checks/ubuntu-runtime-config.h' | sha256sum -c -
RUN find /etc/apt/sources.list.d -name '*.sources' -exec sed -i -E 's/^(Types:[[:space:]]+deb)([[:space:]]*)$/\1 deb-src\2/' {} + && apt-get update
WORKDIR /work
RUN apt-get source --download-only util-linux=2.42.2-1ubuntu2 && python3 /recipe/prepare.py /recipe /work
RUN mkdir /out && python3 /checks/check-idmap-header.py /work/source /out/idmap-header-diagnostic.json /checks/ubuntu-runtime-config.h
# Independent resolver fallback and actual symlink/magic-link gates remain intact.
RUN python3 /recipe/check-openat-resolve.py /work/source /out/openat-resolve-diagnostic.json /checks/ubuntu-runtime-config.h
RUN python3 /checks/check-resolver-self-conflict.py /out/resolver-self-conflict.json
FROM scratch AS export
COPY --from=diagnostic /out /
