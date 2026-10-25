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
