# Retained-source gate replay only. No full util build or native package install.
FROM ubuntu:26.10@sha256:93e29beff5257b2cdf1c024d831f6d2997e53655a653ff76a811fc9e6564a719 AS recovery
ENV DEBIAN_FRONTEND=noninteractive LC_ALL=C PYTHONDONTWRITEBYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 dpkg-dev quilt ca-certificates libc6-dev=2.44-1ubuntu2
COPY recipe /recipe
COPY checks /checks
RUN echo 'df138a238ded0dd74bb61132c5288ab5f37c3787a5e206b58e819194e9194114  /recipe/SHA256SUMS' | sha256sum -c - && cd /recipe && sha256sum -c SHA256SUMS
COPY --from=failed-source / /retained-evidence/
RUN mkdir /retained && python3 /checks/restore-retained.py /retained-evidence /retained
RUN find /etc/apt/sources.list.d -name '*.sources' -exec sed -i -E 's/^(Types:[[:space:]]+deb)([[:space:]]*)$/\1 deb-src\2/' {} + && apt-get update
WORKDIR /reconstruction
RUN apt-get source --download-only util-linux=2.42.2-1ubuntu2 && python3 /recipe/prepare.py /recipe /reconstruction
RUN python3 /checks/resume-postgates.py /recipe /checks /reconstruction/source /retained /retained-evidence /out
FROM scratch AS export
COPY --from=recovery /out/pristine-replay.json /
COPY --from=recovery /out/recovery-postgates.json /
COPY --from=recovery /out/retained-source-suite-summary.json /
COPY --from=recovery /out/idmap-header-regression.json /
COPY --from=recovery /out/openat-resolve-regression.json /
COPY --from=recovery /out/source-regression.json /
COPY --from=recovery /out/check-util-linux /
