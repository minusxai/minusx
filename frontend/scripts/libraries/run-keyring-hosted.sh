#!/bin/sh
# Host-side CI only; never invoked by the runtime image or local shared builds.
# Argument must identify an already built matching source-builder image.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
image=${1:?Pass matching source-builder image reference}
proof=${2:?Pass in-image path to run-keyring-source-proof.sh}
(cd "$here" && sha256sum -c SHA256SUMS)
# No host directories, credentials, daemon socket or external network are mounted.
# The owned disposable runner may access its kernel keyrings only in this test.
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges \
 --security-opt "seccomp=$here/keyring-seccomp-test.json" \
 --entrypoint /bin/sh "$image" "$proof"
