Same-Debian13 conditional client-library backports

Copy SHA256SUMS-listed files plus manifest, excluding all downloaded source
archives/replay/build directories. Fork builder FROM the ACTUAL runtime profile
before build tools or other custom source overlays. Run sh build.sh. It freezes
existing package files, symlinks, bytes, controls and ownership BEFORE apt or
Python installation, then supports only exact versions in config.json.
No absent runtime package is introduced. Empty profiles emit no debs; consumers
must conditionally install only existing /out/*.deb after ALL final apt steps.

Signed Debian DSC controls and every referenced source archive are hash-pinned;
GPG verification against Debian keyrings is a required Linux build gate. The
original Debian source patches/features/build rules/full upstream test targets
are retained. Quilt imports only the documented compatible upstream backports.
Compiler hardening is explicit. Kernel/KDC services built for upstream tests
are disposable and never shipped. Tests use no production service/credentials.

package.py overlays every original native payload (including existing plugins)
from matching rebuilt Debian runtime packages on the frozen inventory. It gates
all old exports/SONAMEs, retains all original nonnative files, modes, ownership,
configuration, maintainer scripts, Pre-Depends and Depends, and adds generated
Debian native dependency requirements. No root-owner-group rewriting is used.
Unique receipts/licenses are appended under /usr/share/doc/runtime-libraries/
<package>/; preserve this directory in final dpkg path filters. Existing original
license/copyright files and documentation aliases are retained unchanged.
+runtime1 denotes documented source backports, not newer upstream releases.

Final fixture contract: mount /out/check-{krb5,p11,elf,freetype} as disposable
test-only tools; mount check-final.py plus adjacent config.json. Run
python3 check-final.py --test-tools /test-tools after final deb installation.
It verifies exact installed native bytes against receipts and executes only
fixtures corresponding to preexisting libraries, without builder loader paths.
Kerberos actual target profiles contain all four client-library packages;
partial profiles stop explicitly until a matching standalone fixture exists.

Normal gates: Kerberos principal and GSSAPI name conversion plus AES encryption/
decryption roundtrip; p11-kit PKCS11 URI parsing/formatting; libelf valid new
section before data addition and ordinary string lookup; FreeType embedded
bitmap glyph loading/rendering (no external fonts). Source-specific upstream
suites exposed by Debian rules run normally. Elfutils additionally runs an
explicit failure-enforcing make check because its stock Debian rule ignores
that command failure. FreeType original Autotools Debian build exposes no
matching font suite here; its normal public API fixture is mandatory instead. FreeType normal fixture does not
exercise CID-specific dictionary overlap; do not claim it does.

All original Debian source patches and five selected backports replayed locally
with strict fuzz0. Krb5 seal patch selects unchanged upstream GSSAPI hunks only;
unrelated absent libgssrpc hunks are excluded, not forced. P11 shared-library
build membership is established from actual source Makefile. Read applicability
for exact CVEs, primary URLs, vendor policy caveats and installed components.
Host macOS FreeType/P11 fixture syntax passed. Linux GPG/build/upstream/package/
ABI/public-API/final app gates remain UNRUN until hosted consumer CI passes.
Do not suppress raw scanner source-version rows or claim blanket clearance.

Staged public-API fixtures also run against assembled replacement package library
payloads before export; final-image check remains a separate mandatory gate.

Krb5 test diagnostic-only prerequisite: preserve the already decoded keyctl stderr in Debian Python3 harness instead of concatenating bytes to str. No capability branch/test-selection changes; unexpected errno remains a failure. Strictpatchdryrun0 and six independent extracted-method branch tests passed; hosted real stderr/kernel capability coverage remains pending.

Hosted kernel-keyring applicability: exact observed C-locale exit1 `add_key: Operation not permitted` is unavailable kernel capability, with explicit KEYRING_COVERAGE notice. All other unexpected errors still fail. The original upstream source suite continues all non-keyring cases. This is not a keyring test pass.
A feasible bounded coverage gate is provided, not yet executed: build/export the SAME matching libraries source-builder stage as a test image (including /libraries-work/source-krb5/build), then `sh run-keyring-hosted.sh IMAGE IN_IMAGE_PATH/run-keyring-source-proof.sh`. It invokes a disposable network-none container with cap-drop ALL, no-new-privileges, no host data/socket/credential mounts, and exact official Moby default seccomp policy plus ONLY add_key/keyctl/request_key allowed. These calls are not namespaced, so use only an owned dedicated ephemeral CI runner. Do not apply this profile to runtime/production. No privileged/unconfined mode.
The source gate sets KRB5_REQUIRE_KEYRING_TESTS=1, probes actual add_key, and reruns full upstream make check; unavailable tool/cache/kernel branches then HARD FAIL. Retain its logs as actual coverage evidence. No Linux keyring execution, custom-profile acceptance, or source-suite pass is claimed from local static/13branch fixtures. If the runner kernel still refuses calls, record actual errno as a coverage gap rather than silently green it.
