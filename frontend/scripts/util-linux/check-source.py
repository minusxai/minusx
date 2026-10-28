"""Exercise patched source with ordinary temporary files and mock mount status.

No namespaces, mount syscalls, privileged cgroups or adversarial inputs are used.
The compiled fixtures use the actual patched functions/branches, not copies of
their implementation. The complete distro upstream suite runs separately.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

root, output = map(Path, sys.argv[1:3])
nsenter = (root / 'sys-utils/nsenter.c').read_text()
mount = (root / 'libmount/src/context_mount.c').read_text()
context = (root / 'libmount/src/context.c').read_text()
rules = (root / 'debian/rules').read_text()


def function(text, signature):
    start = text.index(signature + '\n{')
    end = text.index('\n}', start) + 2
    return text[start:end]


open_cgroup = function(nsenter, 'static void open_cgroup_procs(void)')
join_cgroup = function(nsenter, 'static void join_into_cgroup(void)')
joined = re.search(r'if \(cgroup_procs_fd >= 0\) \{\s*join_into_cgroup\(\);\s*'
                   r'close\(cgroup_procs_fd\);\s*cgroup_procs_fd = -1;\s*\}', nsenter)
assert joined
assert 'int cgroup_fd = -1;' in open_cgroup
assert 'close(cgroup_fd);' in open_cgroup
assert 'O_WRONLY | O_APPEND | O_CLOEXEC' in open_cgroup
failed = function(mount, 'static int is_mount_stage_failed(struct libmnt_context *cxt)')
flat = re.sub(r'\s+', ' ', mount)
assert 'if (res == 0 && !is_mount_stage_failed(cxt))' in flat
assert 'if (rc == 0 && !is_mount_stage_failed(cxt))' in flat
source_function = context[context.index('int mnt_context_prepare_srcpath('):]
start = source_function.index('if (mnt_context_is_restricted(cxt)) {')
end = source_function.index('\n\n\t\tif (path && strcmp(path, src)', start)
canonicalize = source_function[start:end]
assert 'ul_startswith(src, "/dev/")' in canonicalize
assert 'if (path && !ul_startswith(path, "/dev/"))' in canonicalize
assert '--disable-libmount-mountfd-support' not in rules
assert '--disable-chfn-chsh' in rules

login = (root / 'login-utils/login.c').read_text()
subdir = (root / 'libmount/src/hook_subdir.c').read_text()
hook_mount = (root / 'libmount/src/hook_mount.c').read_text()
assert 'api->subdir' not in hook_mount  # vulnerable detached-tree fast path absent
required = function(context, 'int mnt_context_target_fd_required(struct libmnt_context *cxt)')
assert 'return mnt_context_is_restricted(cxt);' in required
pre = subdir[subdir.index('static int hook_mount_pre('):]
guard_start = pre.index('if (mnt_context_target_fd_required(cxt)) {')
guard_end = pre.index('\n\t}', guard_start) + len('\n\t}')
subdir_guard = pre[guard_start:guard_end]
assert 'return -ENOTSUP;' in subdir_guard
assert guard_end < pre.index('tmptgt_unshare(')
remote = function(login, 'static void init_remote_info(struct login_context *cxt, char *remotehost)')
remote_branch = remote[remote.index('cxt->cmd_hostname = xstrdup(remotehost);'):remote.index('\n\tmemset(&hints')]
pam_line = 'rc = pam_set_item(pamh, PAM_RHOST, cxt->cmd_hostname);'
assert pam_line in login

report = {'source_files_sha256': {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
          for path in [root / 'sys-utils/nsenter.c', root / 'libmount/src/context.c',
                       root / 'libmount/src/context_mount.c', root / 'debian/rules']},
          'source_invariants': ['cgroup descriptor closed after migration and CLOEXEC',
                                'temporary cgroup metadata descriptor closed',
                                'both post-mount stages reject failed helper/syscall',
                                'restricted source canonicalization bounded to /dev',
                                'Debian mountfd enabled and chfn/chsh disabled',
                                'restricted subdir rejected before legacy temporary tree',
                                'original login FQDN retained for PAM_RHOST'],
          'fixtures_executed': []}

if '--fixtures' in sys.argv[3:]:
    with tempfile.TemporaryDirectory(prefix='util-linux-regression-') as temporary:
        directory = Path(temporary)
        (directory / 'group').mkdir()
        (directory / 'group/cgroup.procs').write_text('')
        (directory / 'metadata').write_text('0::group\n')

        def execute(name, code):
            source, binary = directory / (name + '.c'), directory / name
            source.write_text(code)
            subprocess.run(['cc', '-O2', '-Wall', '-Wextra', '-Werror', str(source), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True, timeout=10)
            report['fixtures_executed'].append(name)

        execute('ordinary-cgroup-fd-lifecycle', r'''
#define _GNU_SOURCE
#include <assert.h>
#include <err.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#define _(x) (x)
#define stringify_value(x) "4294967295"
''' + '#define _PATH_SYS_CGROUP ' + json.dumps(str(directory)) + '\n' + r'''
static int cgroup_procs_fd = -1;
static int metadata_fd = -1;
static void open_target_fd(int *fd, const char *type, const char *path) {
    (void)type; (void)path;
    assert(*fd == -1);
    int original = open(_PATH_SYS_CGROUP "/metadata", O_RDONLY);
    assert(original >= 0);
    *fd = fcntl(original, F_DUPFD_CLOEXEC, 64);
    assert(*fd >= 64);
    close(original);
    metadata_fd = *fd;
}
static ssize_t read_all_alloc(int fd, char **buffer) {
    *buffer = calloc(32, 1);
    assert(*buffer);
    return read(fd, *buffer, 31);
}
static int write_all(int fd, const char *buffer, size_t length) {
    return write(fd, buffer, length) == (ssize_t)length ? 0 : -1;
}
''' + open_cgroup + '\n' + join_cgroup + r'''
int main(void) {
    open_cgroup_procs();
    assert(fcntl(metadata_fd, F_GETFD) == -1 && errno == EBADF);
    int original = cgroup_procs_fd;
    assert((fcntl(original, F_GETFD) & FD_CLOEXEC) != 0);
''' + joined.group() + r'''
    assert(cgroup_procs_fd == -1);
    assert(fcntl(original, F_GETFD) == -1 && errno == EBADF);
    FILE *file = fopen(_PATH_SYS_CGROUP "/group/cgroup.procs", "r");
    unsigned long value = 0;
    assert(file && fscanf(file, "%lu", &value) == 1);
    assert(value == (unsigned long)getpid());
    fclose(file);
    return 0;
}
''')
        execute('ordinary-mount-status', r'''
#include <assert.h>
struct libmnt_context { int helper, helper_status, syscall, status; };
static int mnt_context_helper_executed(struct libmnt_context *c) { return c->helper; }
static int mnt_context_get_helper_status(struct libmnt_context *c) { return c->helper_status; }
static int mnt_context_syscall_called(struct libmnt_context *c) { return c->syscall; }
static int mnt_context_get_status(struct libmnt_context *c) { return c->status; }
''' + failed + r'''
int main(void) {
    struct libmnt_context cases[] = {
        {1, 0, 0, 0}, {1, 1, 0, 0}, {1, 2, 1, 1},
        {0, 0, 1, 1}, {0, 0, 1, 0}, {0, 0, 0, 0}
    };
    int expected[] = {0, 1, 1, 0, 1, 0};
    for (unsigned i = 0; i < sizeof(cases)/sizeof(cases[0]); i++)
        assert(is_mount_stage_failed(&cases[i]) == expected[i]);
    return 0;
}
''')
        execute('ordinary-source-canonicalization', r'''
#include <assert.h>
#include <stddef.h>
#include <string.h>
struct libmnt_context { int restricted; };
static char *resolved;
static int calls;
static int mnt_context_is_restricted(struct libmnt_context *c) { return c->restricted; }
static int ul_startswith(const char *s, const char *prefix) {
    return strncmp(s, prefix, strlen(prefix)) == 0;
}
static char *mnt_resolve_path(const char *src, void *cache) {
    (void)src; (void)cache; calls++; return resolved;
}
static char *evaluate(struct libmnt_context *cxt, const char *src) {
    void *cache = NULL;
    char *path = NULL;
''' + canonicalize + r'''
    return path;
}
int main(void) {
    struct libmnt_context restricted = {1}, unrestricted = {0};
    resolved = "/tmp/ordinary";
    assert(evaluate(&restricted, "/tmp/input") == NULL && calls == 0);
    assert(evaluate(&restricted, "/dev/input") == NULL && calls == 1);
    resolved = "/dev/ordinary";
    assert(evaluate(&restricted, "/dev/input") == resolved && calls == 2);
    assert(evaluate(&unrestricted, "/tmp/input") == resolved && calls == 3);
    return 0;
}
''')
        execute('ordinary-login-fqdn', r"""
#define _GNU_SOURCE
#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
struct login_context { char *hostname, *cmd_hostname; };
static char *xstrdup(const char *s) { char *v = strdup(s); assert(v); return v; }
#define PAM_RHOST 4
static const char *received;
static int pam_set_item(void *pamh, int item, const char *value) {
    (void)pamh; assert(item == PAM_RHOST); received = value; return 0;
}
static void evaluate(struct login_context *cxt, char *remotehost, const char *domain) {
    char *p;
""" + remote_branch + r"""
    int rc;
    void *pamh = NULL;
""" + pam_line + r"""
    assert(rc == 0);
}
int main(void) {
    char input[] = "ordinary.example.invalid";
    struct login_context c = {0};
    evaluate(&c, input, "example.invalid");
    assert(strcmp(c.hostname, "ordinary") == 0);
    assert(strcmp(received, "ordinary.example.invalid") == 0);
    free(c.hostname); free(c.cmd_hostname);
    return 0;
}
""")
        execute('ordinary-restricted-subdir', r"""
#include <assert.h>
#include <errno.h>
struct libmnt_context { int restricted; };
static int mnt_context_is_restricted(struct libmnt_context *c) { return c->restricted; }
#define DBG(category, code) do {} while (0)
""" + required + r"""
static int evaluate(struct libmnt_context *cxt) {
""" + subdir_guard + r"""
    return 0;
}
int main(void) {
    struct libmnt_context restricted = {1}, unrestricted = {0};
    assert(evaluate(&restricted) == -ENOTSUP);
    assert(evaluate(&unrestricted) == 0);
    return 0;
}
""")
output.write_text(json.dumps(report, indent=2) + '\n')
print('Source invariants and ordinary fixtures:', report['fixtures_executed'])
