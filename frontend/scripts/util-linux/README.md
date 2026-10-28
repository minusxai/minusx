Build the exact Debian trixie util-linux 2.41.5-0+deb13u1 source with the pinned
upstream security backports in source.json. Install only the three packages
already present: util-linux, libmount1 and login. Debian's special login epoch
and binary-version derivation are retained explicitly per package.

APT authenticates the source against its signed Debian source index; the recipe
also enforces exact archive SHA256 and sizes. The stable 2.41 patches are used
rather than another distribution's source or binaries. The explicit nsenter
close patch adapts read_all_alloc context and omits the already applied CLOEXEC
hunk. Debian already carries the restricted-source canonicalization fix, so that
patch is not reapplied. The normal complete Linux distro build/test target runs
without nocheck or reduced build profiles. Source C fixtures use ordinary files
and mock status, without mount operations, namespaces or privileged cgroups.

Debian's fd-based mount API stays enabled. The pristine original payloads,
status and maintainer controls are captured before APT bootstrap. Original native
hashes must still match before ABI and full feature-set capture. Original paths,
modes, owners, links, exports and package relationships are retained. Every
original non-native runtime/configuration file and maintainer control remains
byte-identical; intentional exceptions are native security rebuilds, generated
package version/dependency metadata, md5sums and documentation. Dependencies
retain original constraints alongside newly derived requirements. Protected and
Essential fields are checked. The installed native gate requires the complete
original feature set and version; native SHA256 checks bind the rebuilt payloads
to source/configuration/test receipts. Package audit requires zero status and
empty combined standard output/error.

CVE-2022-0563's chfn/chsh programs are disabled by this Debian source build and
provided by shadow/passwd. For CVE-2026-78409, this exact source lacks the detached
tree fast path; the existing subdir path rejects restricted callers before its
temporary-tree operation. Gates check those predicates rather than inferring
exclusion from a version. Five actual-source C fixtures exercise cgroup fd
lifecycle, failed-mount status, source canonicalization, login FQDN preservation
for PAM_RHOST, and restricted subdir rejection. The unchanged full source tests
run separately. Local fixture success does not establish a successful Linux
package/image build: hosted build, installed gates and application checks must
all pass before qualification.

Original package-listed documentation omissions remain absent in replacement
packages and are checked after installation. Lintian overrides (and their empty
parent directories) may be omitted only when the original preserved dpkg policy
contains exactly `path-exclude /usr/share/lintian/overrides/*`. No other missing
lintian content, runtime or configuration receives an exception. Original policy
bytes and full/present/absent path lists are retained in /out; source receipts
remain available there even when their documentation directory must stay absent.

The idmap source-pinning caller also requires fileutils.h, which owns the portable
RESOLVE_NO_SYMLINKS fallback. The explicit local header prerequisite preserves
all capability guards. Its ordinary C check compiles the actual caller expression
against the actual source header, without supplying resolver definitions, and
requires the removed-header undeclared-constant negative control to fail. This
covers the include integration that an isolated mock constant cannot test.

The real-header fixture runs only after the complete source build, using the
saved regular runtime config.h with compiler -include. It does not guess or
supply configure feature macros; libc declarations and source fallback functions
therefore use the same configuration as the actual runtime translation units.
The removed-header negative control and -Werror remain enabled.
