This recipe preserves the Ubuntu 26.10 util-linux 2.42.2-1ubuntu2 source packaging,
build options and package interfaces while backporting the reviewed upstream
mount and namespace fixes in source.json. It installs only the already present
util-linux and libmount1 binary packages.

The source archives are fetched through APT's signed Ubuntu source indexes and
then checked against pinned SHA256/size values. All upstream patches are pinned;
the nsenter cgroup-close patch changes one context-only function name to match
2.42.2. The complete Linux distro build/test target remains enabled, with no
nocheck or reduced build profile. Source tests use ordinary temporary files and
mock mount status, without mounting, namespaces or privileged cgroup operations.

The Ubuntu build disables the fd-based mount API. Debian later reconfigures for
installer udebs, so the recipe records the normal runtime configuration directly
after the regular Linux test target. The installed-library gate checks that its
reported features still exclude fd-based-mount. Native payload hashes bind that
configuration/source/test proof to the installed packages. Original file paths,
modes, owners, symlinks, relationships and library exports are checked, and the
original dependency constraints are retained alongside generated requirements.
Original package paths, payload bytes and maintainer controls are captured before
APT bootstrap. Native hashes must still match that snapshot before recording the
original libmount feature set. Every original non-native runtime file and
maintainer control is retained byte-for-byte; native security rebuilds, generated
package version/dependency metadata, checksums and documentation are the explicit
exceptions. The installed gate compares the full original feature set as well as
requiring the fd-based mount API to remain disabled. Package audit requires an
exit status of zero and empty combined standard output/error.

Upstream v2.42.3 alone is insufficient evidence for CVE-2026-78408: its nsenter
source still leaves cgroup.procs open. This recipe includes the actual close and
CLOEXEC fix from master afe067c in addition to the stable branch's incomplete
descriptor hardening. The three ordinary source fixtures check that fd lifecycle,
both failed-helper post-hook gates, and restricted source canonicalization.

Local source patch application and fixture checks do not establish a successful
Linux package build. The full hosted build, installed native gates and Metabase
functional checks must all pass before treating the candidate as qualified.

Original package-listed documentation omissions remain absent in replacement
packages and are checked after installation. Lintian overrides (and their empty
parent directories) may be omitted only when the original preserved dpkg policy
contains exactly `path-exclude /usr/share/lintian/overrides/*`. No other missing
lintian content, runtime or configuration receives an exception. Original policy
bytes and full/present/absent path lists are retained in /out; source receipts
remain available there even when their documentation directory must stay absent.

The internal mnt_open_tree helper is also needed by the original idmap hook when
the configurable mountfd backend is disabled. Patch 09 is an explicit local
backport integration prerequisite: only that helper's declaration/definition
uses the existing idmap HAVE_MOUNTFD_API && HAVE_LINUX_MOUNT_H capability guard.
Backend state and options remain unchanged. A separate actual-source caller and
helper translation-unit check compiles/links with mountfd disabled and mocks
mount operations; restoring the historical narrow declaration guard is a
required failing compile negative control. Full Linux source build remains the
qualification gate.

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
