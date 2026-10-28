"""Compile the actual idmap caller against the actual private resolver header.

No resolver flags are supplied by the fixture. Removing the real header either
exposes the missing declaration or proves an independent system definition.
Syscalls are mocked; genuine configured/system definitions are retained.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

root, output, configuration = map(Path, sys.argv[1:])
assert configuration.is_file(), "Actual generated runtime configuration required"
idmap = (root / 'libmount/src/hook_idmap.c').read_text()
include = '#include "fileutils.h"'
assert include in idmap[:idmap.index('static int hook_mount_post(')]
caller = re.search(r'fd_tree = mnt_open_tree\(AT_FDCWD, target,.*?;', idmap, re.S).group()
prelude = r'''
#include <assert.h>
#include <fcntl.h>
#include <string.h>
#define OPEN_TREE_CLONE 1
#define OPEN_TREE_CLOEXEC 2
#ifndef AT_RECURSIVE
#define AT_RECURSIVE 4
#endif
'''
body = r'''
struct libmnt_context { int restricted; };
static int mnt_context_is_restricted(struct libmnt_context *cxt) { return cxt->restricted; }
static int mnt_open_tree(int dirfd, const char *path, unsigned long flags, unsigned long long resolve) {
    assert(dirfd == AT_FDCWD && strcmp(path, "/tmp/ordinary") == 0);
    assert(flags & OPEN_TREE_CLONE); assert(flags & OPEN_TREE_CLOEXEC);
    /* The expected Linux ABI value is checked; no definition is injected. */
    assert(resolve == 0 || resolve == 0x04);
    return resolve ? 23 : 24;
}
static int evaluate(struct libmnt_context *cxt, int recursive) {
    const char *target = "/tmp/ordinary";
    int fd_tree;
''' + caller + r'''
    return fd_tree;
}
int main(void) {
    struct libmnt_context restricted = {1}, unrestricted = {0};
    assert(evaluate(&restricted, 0) == 23);
    assert(evaluate(&restricted, 1) == 23);
    assert(evaluate(&unrestricted, 0) == 24);
    return 0;
}
'''
with tempfile.TemporaryDirectory(prefix='idmap-real-header-') as temp:
    directory = Path(temp)
    unit, binary = directory / 'caller.c', directory / 'caller'
    command = ['cc', '-O2', '-Wall', '-Wextra', '-Werror', '-include', str(configuration.resolve()), '-I', str(root), '-I', str(root / 'include')]
    unit.write_text(prelude + include + '\n' + body)
    subprocess.run(command + [str(unit), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True, timeout=10)
    unit.write_text(prelude + body)
    failure = subprocess.run(command + [str(unit), '-o', str(binary)], capture_output=True, text=True)
    if failure.returncode != 0:
        assert 'RESOLVE_NO_SYMLINKS' in failure.stderr, failure.stderr
        independent_system_definition = False
    else:
        # New glibc exposes openat2 flags through fcntl.h. Prove that this
        # genuine header route supplies the exact ABI value; do not undefine
        # or replace it merely to manufacture a missing-header failure.
        subprocess.run([str(binary)], check=True, timeout=10)
        unit.write_text(prelude + '\n_Static_assert(RESOLVE_NO_SYMLINKS == 0x04, "Linux resolver ABI");\nint main(void) { return 0; }\n')
        trace = subprocess.run(command + ['-H', str(unit), '-o', str(binary)], capture_output=True, text=True)
        assert trace.returncode == 0, trace.stderr
        headers = [Path(line.lstrip('. ')) for line in trace.stderr.splitlines()
                   if line.startswith('.') and Path(line.lstrip('. ')).is_file()]
        system_headers = {str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in headers if str(path.resolve()).startswith('/usr/include/')}
        assert any(path.endswith('/fcntl.h') for path in system_headers)
        assert any(path.endswith('/bits/openat2.h') for path in system_headers)
        independent_system_definition = True
report = {'generated_config_sha256': hashlib.sha256(configuration.read_bytes()).hexdigest(),
          'fixture_supplies_configure_feature_macros': False, 'actual_private_header': 'include/fileutils.h', 'fixture_defines_resolve_flags': False,
          'actual_idmap_caller_compile_and_execution': True,
          'removed_header_undeclared_resolve_negative_control': not independent_system_definition,
          'removed_header_independent_system_definition': independent_system_definition,
          'independent_system_header_sha256': system_headers if independent_system_definition else {},
          'restricted_recursive_unrestricted_checks': True, 'mount_syscalls_mocked': True,
          'source_sha256': {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in
                            ['libmount/src/hook_idmap.c', 'include/fileutils.h', 'include/c.h']}}
output.write_text(json.dumps(report, indent=2) + '\n')
print('Actual idmap caller and configured/system header contract checks passed')
