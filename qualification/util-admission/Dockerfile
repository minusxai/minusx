# Package-only and clean-runtime qualification; no C source rebuild or application.
FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS base
COPY patch-npm.mjs /tmp/patch-npm.mjs
RUN npm install --global --no-audit --no-fund npm@12.2.1 && node /tmp/patch-npm.mjs && npm cache clean --force
FROM base AS runtime-profile
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM runtime-profile AS tools
COPY tool-recipe /tool-recipe
RUN mkdir /perl-work && node /tool-recipe/capture-tool-empty-directories.mjs /perl-work/original-tool-empty-dirs.json && \
    apt-get update && apt-get install -y --no-install-recommends python3 dpkg-dev binutils && python3 /tool-recipe/prepare-tools.py /resolver-tools

FROM runtime-profile AS packaged
ENV PYTHONDONTWRITEBYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 dpkg-dev binutils
COPY --from=compiled-util / /out/
COPY recipe /recipe
COPY checks /checks
RUN echo '91e393d7960901098ebe89f48fb36445391779673cede66abc43fa9ca3737cb1  /out/compile-proof.json' | sha256sum -c - && \
    echo 'fe8adfb969ba5f4df135ec1062681fb8d29e3abd4b49fa6c91322f80e4306ef9  /checks/package.py' | sha256sum -c - && \
    echo 'a3b2984bafc64c9643ebca237db85a0b86511b3559b331d7a431b6023478d75b  /checks/mount-metadata-only.py' | sha256sum -c -
RUN mkdir /work && rm -rf /out/compile-inputs && mkdir /out/compile-inputs && \
    python3 /checks/restore-inputs.py /out /work && python3 /checks/restore-inputs.py /out /out/compile-inputs && \
    python3 /checks/restore-output-metadata.py /out && \
    python3 /checks/replace-package-implementation.py /recipe /checks/package.py /out/compile-proof.json
RUN UTIL_LINUX_COMPILE_PROOF_SHA256=91e393d7960901098ebe89f48fb36445391779673cede66abc43fa9ca3737cb1 \
    UTIL_LINUX_PACKAGE_IMPLEMENTATION_SHA256=fe8adfb969ba5f4df135ec1062681fb8d29e3abd4b49fa6c91322f80e4306ef9 \
    python3 /recipe/phase-proof.py verify /recipe /work /out
RUN UTIL_LINUX_COMPILE_PROOF_SHA256=91e393d7960901098ebe89f48fb36445391779673cede66abc43fa9ca3737cb1 \
    python3 /recipe/package.py package /recipe /work && \
    python3 /checks/mount-metadata-only.py /work/original/mount /out/mount.deb > /out/mount-postprocess.json && \
    python3 /checks/prepare-plan.py /checks /work /out /acceptance-inputs

FROM runtime-profile AS native
COPY checks /checks
COPY --from=packaged /acceptance-inputs /inputs
COPY --from=tools /resolver-tools/tool-closure.json /tool-closure.json
RUN chmod 0755 /checks/resolver /checks/accept-util-native.sh
# Only this explicit target executes the separately reviewed four-package plan.
RUN --mount=from=packaged,source=/out,target=/candidate-debs,readonly \
    --mount=from=tools,source=/resolver-tools/root,target=/qualification-tools,readonly \
    sh /checks/accept-util-native.sh /checks/resolver /checks /inputs /candidate-debs /qualification-result

FROM scratch AS package-export
COPY --from=packaged /acceptance-inputs /
COPY --from=packaged /out/libmount1.deb /packages/libmount1.deb
COPY --from=packaged /out/util-linux.deb /packages/util-linux.deb
COPY --from=packaged /out/login.deb /packages/login.deb
COPY --from=packaged /out/mount.deb /packages/mount.deb
COPY --from=packaged /out/mount-postprocess.json /
FROM scratch AS native-export
COPY --from=native /qualification-result/dependency-closure.json /
COPY --from=native /qualification-result/apt-plan.json /
COPY --from=native /qualification-result/final-native.json /
COPY --from=native /qualification-result/apt-simulation.txt /
COPY --from=native /qualification-result/apt-simulation.stderr /
COPY --from=native /qualification-result/dpkg-audit.stdout /
COPY --from=native /qualification-result/dpkg-audit.stderr /
COPY --from=native /qualification-result/before-packages.tsv /
COPY --from=native /inputs/plan.json /
COPY --from=tools /resolver-tools/tool-closure.json /
