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
    echo '53a0675a42823a9fd32f54ef17691e63fba22422f1df5731560e4d8a230ca9f0  /checks/package.py' | sha256sum -c - && \
    echo '69d3f5695d7da07416c9935524c9880fe851ef57a083f0bc2dfed32ad71f93bf  /checks/mount-metadata-only.py' | sha256sum -c -
RUN mkdir /work && rm -rf /out/compile-inputs && mkdir /out/compile-inputs && \
    python3 /checks/restore-inputs.py /out /work && python3 /checks/restore-inputs.py /out /out/compile-inputs && \
    python3 /checks/restore-output-metadata.py /out && \
    python3 /checks/replace-package-implementation.py /recipe /checks/package.py /out/compile-proof.json
RUN UTIL_LINUX_COMPILE_PROOF_SHA256=91e393d7960901098ebe89f48fb36445391779673cede66abc43fa9ca3737cb1 \
    UTIL_LINUX_PACKAGE_IMPLEMENTATION_SHA256=53a0675a42823a9fd32f54ef17691e63fba22422f1df5731560e4d8a230ca9f0 \
    python3 /recipe/phase-proof.py verify /recipe /work /out
RUN UTIL_LINUX_COMPILE_PROOF_SHA256=91e393d7960901098ebe89f48fb36445391779673cede66abc43fa9ca3737cb1 \
    python3 /checks/package-stage.py /checks /recipe /work /out

FROM runtime-profile AS native
COPY checks /checks
COPY --from=packaged /acceptance-inputs /inputs
COPY --from=tools /resolver-tools/tool-closure.json /tool-closure.json
COPY --from=packaged /package-status.json /package-status.json
RUN node -e 'const r=JSON.parse(require("fs").readFileSync("/package-status.json")); require("assert").deepStrictEqual(r,{kind:"util-package-transport",status:"package-only-unadmitted",source_compiled:false,native_admitted:false,exit_codes:{source:0,mount:0,plan:0}});' && chmod 0755 /checks/resolver /checks/accept-util-native.sh
# Only this explicit target executes the separately reviewed four-package plan.
RUN --mount=from=packaged,source=/out,target=/candidate-debs,readonly \
    --mount=from=tools,source=/resolver-tools/root,target=/qualification-tools,readonly \
    sh /checks/accept-util-native.sh /checks/resolver /checks /inputs /candidate-debs /qualification-result

FROM scratch AS package-export
COPY --from=packaged /package-export/ /
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
