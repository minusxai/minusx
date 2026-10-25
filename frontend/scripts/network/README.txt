Shared Debian trixie network source recipe

Consumer contract
Snapshot an actual runtime-profile stage BEFORE build dependencies and BEFORE
custom ncurses/source overlays. Fork independent networkbuilder FROM that stage;
custom ncurses6.6 must not precede apt libedit-dev (Debian dev package has exact
ncurses6.5 constraints). Final FROM runtime-profile consumes all completed source
overlays only after runtime apt/npm steps. Do not snapshot a source-only builder
that already added curl/Python or it will incorrectly introduce absent packages.

Copy this directory into an architecture/base-matched disposable trixie builder
as /runtime-build/network. Run:
  sh /runtime-build/network/build-network.sh
Artifacts: /out/{curl,libcurl4t64,libcurl3t64-gnutls,openssh-client}.deb,
restricted to packages installed before development dependencies were added.
Install all produced debs together after all runtime apt operations. Do not copy
builder /usr trees or install development packages into runtime. Preserve /out
artifacts as CI evidence. Call the final-image behavior checker separately with
Python3, openssl and disposable test-only sshd/helpers available; the latter may
be mounted from builder output rather than installed in the runtime:
  python3 check-network.py --ssh-server /test-tools/sshd --ssh-libexec /test-tools
Run as the disposable fixture user/root; no production credentials or calls.
Keep check-network.py and network_common.py together. The SSH fixture uses an
inherited private stream (sshd -i), not an externally listening service.

Coverage and compatibility
curl8.18.0 plus the authenticated public Ubuntu8.18.0-1ubuntu2.8 CVE
backports retains interfaces removed by newer releases (RTMP8.20, TLS-SRP8.22,
SMB8.23). Both builds explicitly enable NTLM/TLS-SRP/SMB/IPFS and librtmp.
The source DSC signature must match the official publication signer; exact
archive hashes and all59 CVE-patch hashes/order are checked. Distro build-only
patches are excluded. Regenerated build inputs are required. CVE-2026-19931
remains unresolved: upstream removed its historical restriction and assigns
ambient-credential reuse management to applications. No all39-fixed claim.
Preserve both installed TLS variants, GSSAPI, libssh2,
OpenLDAP, HTTP2/3, IDN/PSL and compression features. Builds fail if any old
versioned exported ABI, protocol, feature bit, TLS backend or SONAME is lost.
GnuTLS retains Debian libcurl-gnutls.so.4 and CURL_GNUTLS_3 namespace. Upstream's
configure version suffix is changed4→3 before that build, and patchelf changes
only the generated library SONAME/install name. Source function logic unchanged.

OpenSSH10.6p1 preserves client utilities and helpers. Debian split GSSAPI key
exchange into openssh-gssapi after the installed10.0 generation; carry its current
10.6p1 Debian-maintained gssapi.patch rather than silently remove the feature.
The two companion Debian documentation patches retain agent/argv0 documentation.
The fixture explicitly checks GSSAPIKeyExchange configuration remains accepted.
This does not establish a real Kerberos realm exchange or FIDO hardware test.
Existing package files/config/services and original control dependencies,
pre-dependencies, maintainer scripts, triggers, conffiles, shlibs/symbol metadata,
ownership/modes are retained; actual ELF dependencies are additionally derived
using same-base dpkg-shlibdeps. No sshd/server package is added to runtime.
Old manual pages are retained alongside current upstream license and source
provenance; upstream/debian documentation changes beyond those two patches are
not claimed. Other Debian server-only customization is outside client packaging.

Gates
Archive checksums; GPG signatures using checksum-pinned official release keys;
ordinary upstream curl HTTP GET test1 for both builds; ordinary upstream SSH
agent regression; strict versioned symbol exports and capability-set checks;
local CA-verified TLS transfers through both real libcurl ABIs and curl CLI;
authenticated SSH command, SFTP-backed scp upload/download, ssh-agent lifecycle.
Final-image checker verifies actual loader resolution after installation.
No malformed-input/adversarial reproduction tests are created or run here.

Validation truth
Local PASS: Python syntax compile, POSIX shell syntax, checksum fetch replay,
OpenSSH checksum matches official release notes, curl checksum matches official
GitHub release asset digest; all three Debian patches strict-fuzz0 dry-run apply
to exact10.6p1 tarball. No local Docker or candidate binary build was run, per
shared resource hold. GPG verification, source compilation, upstream tests,
packaging and runtime fixtures are REQUIRED HOSTED GATES and remain UNRUN until
consumer CI actually executes them. Never call these recipes/images fixed based
only on this static validation. Preserve full final inventory and all-severity
scan artifacts. No claim that upstream-current alone clears OS dependencies.

Primary sources
https://curl.se/download.html
https://ubuntu.com/security/notices/USN-8927-1
https://curl.se/dev/deprecate.html
https://curl.se/docs/vuln-8.14.1.html
https://www.openssh.org/txt/release-10.6
https://salsa.debian.org/ssh-team/openssh-gssapi/-/raw/master/debian/patches/gssapi.patch
https://salsa.debian.org/ssh-team/openssh-gssapi/-/raw/master/debian/changelog
https://salsa.debian.org/ssh-team/openssh/-/raw/master/debian/patches/ssh-agent-setgid.patch
https://salsa.debian.org/ssh-team/openssh/-/raw/master/debian/patches/ssh-argv0.patch

Outstanding upstream gaps from original review remain separate: client legacy
SCP/terminal/known-host policy issues, absent SSH server source matches, and
unrelated OS/runtime advisories are not silently marked cleared by this recipe.

Conditional existing-server profile: openssh-server and openssh-sftp-server are
included only if preinstalled. Server builds use the FULL official Debian
openssh-gssapi10.6p1-1 patch series (server-debian-provenance.json), preserving
integrated GSSAPI/SELinux monitor IDs, socket activation and TCP wrappers.
PAM, SELinux, Linux audit, wtmpdb, libcrypt and existing server integration
files/configuration/maintainer scripts are retained. No host keys are shipped.
Final checks use actual installed sshd/helpers, verify PAM/GSSAPI configuration,
and run private-stream authenticated SSH and external-SFTP fixtures. No listener
or production call is used. Linux server gates remain UNRUN pending hosted CI.
Copy every SHA256SUMS-listed input, including server-debian-patches/*.
Do not copy replay trees or archives. New receipts use unique
/usr/share/doc/runtime-network/<package>/; preserve this directory in filters
while keeping original documentation aliases unchanged.

Bootstrap: POSIX dpkg-query captures eligible names/versions before Python or
build tools. Empty profiles exit before installing anything. A builder-only
Python/dpkg-dev/binutils bootstrap then snapshots only that explicit profile,
asserting bootstrap did not change any eligible runtime version. It never
infers runtime eligibility from development dependencies.

Bootstrap caveat: name/version equality detects upgrades, not same-version file
mutation; ordinary apt bootstrap does not intentionally reinstall eligible files.
Mandatory sshd-auth and sshd-session helpers are packaged even when not present
in older server inventories; authenticated fixture exercises their actual paths.

HTTP/3 correction: curl8.19 removed native OpenSSL-QUIC. Build official ngtcp2 1.25.0 as PIC static core/crypto archives, embed in libcurl using the corresponding original OpenSSL/GnuTLS backend. Pinned official release asset digest, provenance and license are retained in each curl package receipt. No ngtcp2 shared library/package or build RPATH ships. Upstream make check and final feature/protocol/ABI/TLS gates remain required. Linux build gates for this correction have NOT yet run. Frozen original curl capabilities are printed before build dependencies.

Required ordinary HTTP3 transfer gate: check-http3.py launches official same-source osslserver/gtlsserver on disposable loopback UDP ports. Each staged TLS variant must negotiate HTTP3-only with a local trusted certificate, report HTTP version3 and return byte-exact data. Fixture-only nghttp3 1.18 is separately pinned/static; it is built after runtime curl and does not enter shipped libraries. Source crypto flags are fail-closed via Autoconf fatal option checking and required backend archive files. Linux fixture execution remains UNRUN locally.
