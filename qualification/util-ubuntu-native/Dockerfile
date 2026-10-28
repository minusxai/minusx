# Exactly three prepared packages; no utility source compilation/postprocessing.
FROM ubuntu:26.10@sha256:93e29beff5257b2cdf1c024d831f6d2997e53655a653ff76a811fc9e6564a719 AS runtime-profile
ENV LC_ALL=C DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends ca-certificates fontconfig fonts-dejavu-core libstdc++6 tzdata zlib1g && rm -rf /var/lib/apt/lists/*
FROM runtime-profile AS tools
COPY tool-recipe /tool-recipe
COPY resolver-launcher-generator.py /resolver-launcher-generator.py
RUN mkdir /perl-work && /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C /usr/bin/perl -T /tool-recipe/capture-tool-empty-directories.pl /perl-work/original-tool-empty-dirs.tsv && \
    apt-get update && apt-get install -y --no-install-recommends perl python3 dpkg-dev binutils && python3 /tool-recipe/prepare-tools.py /resolver-tools && \
    runtime_sha=$(sha256sum /resolver-tools/root/tool-runtime.json | cut -d' ' -f1) && python3 /resolver-launcher-generator.py /resolver-tools/root/tool-runtime.json "$runtime_sha" /resolver
FROM runtime-profile AS native
COPY checks /checks
COPY --from=prepared-util / /inputs
COPY --from=tools /resolver-tools/tool-closure.json /tool-closure.json
COPY --from=tools /resolver /checks/resolver
RUN test -x /bin/sh && test -x /usr/bin/env && chmod 0755 /inputs/check-util-linux /inputs/check-absence.sh
RUN --network=none --mount=from=prepared-util,source=/packages,target=/candidate-debs,readonly \
    --mount=from=tools,source=/resolver-tools/root,target=/qualification-tools,readonly \
    --mount=from=target-evidence,source=/,target=/target-reference,readonly \
    sh /checks/retain-native.sh /checks/resolver /checks /inputs /candidate-debs /qualification-result
FROM scratch AS native-export
COPY --from=native /native-export/ /
