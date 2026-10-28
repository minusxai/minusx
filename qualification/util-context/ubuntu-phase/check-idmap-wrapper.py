"""Compile actual wrapper declaration/definition and idmap caller with mountfd off.

Dependencies and mount syscalls are mocked; no mount or namespace is performed.
A separate caller translation unit makes the historical missing prototype fail.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

root, output = map(Path, sys.argv[1:])
header = (root / 'libmount/src/mountP.h').read_text()
utils = (root / 'libmount/src/utils.c').read_text()
idmap = (root / 'libmount/src/hook_idmap.c').read_text()
guard = '#if defined(HAVE_MOUNTFD_API) && defined(HAVE_LINUX_MOUNT_H)'
prototype = re.search(r'int mnt_open_tree\(int dirfd, const char \*path, unsigned long flags,\n\s*unsigned long long resolve\);', header).group()
assert guard + '\n' + prototype + '\n#endif' in header
start = utils.index('int mnt_open_tree(')
end = utils.index('\n}', start) + 2
implementation = utils[start:end]
assert utils[utils.rfind('#if', 0, start):start].startswith(guard)
assert '#endif /* HAVE_MOUNTFD_API && HAVE_LINUX_MOUNT_H */' in utils[end:]
assert guard in idmap
caller = re.search(r'fd_tree = mnt_open_tree\(AT_FDCWD, target,.*?;', idmap, re.S).group()
prelude = r'''
#include <assert.h>
#include <string.h>
#define HAVE_MOUNTFD_API 1
#define HAVE_LINUX_MOUNT_H 1
#ifdef USE_LIBMOUNT_MOUNTFD_SUPPORT
#error mountfd backend must remain disabled in this regression
#endif
#define AT_FDCWD -100
#define OPEN_TREE_CLONE 1
#define OPEN_TREE_CLOEXEC 2
#define AT_RECURSIVE 4
#define RESOLVE_NO_SYMLINKS 8
#define AT_EMPTY_PATH 16
#define O_PATH 32
#define O_CLOEXEC 64
'''
with tempfile.TemporaryDirectory(prefix='idmap-wrapper-') as tmp:
    directory = Path(tmp)
    # The declaration is kept in the same real conditional as the patched header.
    declaration = guard + '\n' + prototype + '\n#endif\n'
    body = r'''
struct libmnt_context { int restricted; };
static int mnt_context_is_restricted(struct libmnt_context *cxt) { return cxt->restricted; }
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
    assert(evaluate(&unrestricted, 0) == 23);
    return 0;
}
'''
    unit = directory / 'caller.c'
    unit.write_text(prelude + declaration + body)
    command = ['cc', '-O2', '-Wall', '-Wextra', '-Werror', '-Werror=implicit-function-declaration']
    subprocess.run(command + ['-c', str(unit), '-o', str(directory / 'caller.o')], check=True)
    # Historical guard reproduces the actual missing-prototype compile failure.
    unit.write_text(prelude + '#ifdef USE_LIBMOUNT_MOUNTFD_SUPPORT\n' + prototype + '\n#endif\n' + body)
    negative = subprocess.run(command + ['-c', str(unit), '-o', str(directory / 'negative.o')], capture_output=True, text=True)
    assert negative.returncode != 0 and 'mnt_open_tree' in negative.stderr, negative.stderr
    helper = directory / 'helper.c'
    helper.write_text(prelude + declaration + r'''
static int ul_openat_resolve(int dirfd, const char *path, int flags, int mode, unsigned long long resolve) {
    assert(dirfd == AT_FDCWD && strcmp(path, "/tmp/ordinary") == 0);
    assert(flags == (O_PATH | O_CLOEXEC) && mode == 0 && resolve == RESOLVE_NO_SYMLINKS);
    return 17;
}
static int open_tree(int dirfd, const char *path, unsigned long flags) {
    assert(flags & OPEN_TREE_CLONE); assert(flags & OPEN_TREE_CLOEXEC);
    if (flags & AT_EMPTY_PATH) assert(dirfd == 17 && !*path);
    else assert(dirfd == AT_FDCWD && strcmp(path, "/tmp/ordinary") == 0);
    return 23;
}
static int close(int fd) { assert(fd == 17); return 0; }
''' + implementation)
    subprocess.run(command + ['-c', str(helper), '-o', str(directory / 'helper.o')], check=True)
    binary = directory / 'check-wrapper'
    subprocess.run(['cc', str(directory / 'caller.o'), str(directory / 'helper.o'), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True, timeout=10)
report = {'source_sha256': {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in
                          ['libmount/src/mountP.h', 'libmount/src/utils.c', 'libmount/src/hook_idmap.c']},
          'mountfd_backend_defined': False,
          'actual_source_separate_translation_units': True,
          'corrected_declaration_and_definition_compile_link': True,
          'historical_guard_missing_prototype_negative_control': True,
          'ordinary_restricted_recursive_and_unrestricted_caller_checks': True,
          'mount_syscalls_mocked': True}
output.write_text(json.dumps(report, indent=2) + '\n')
print('Disabled-mountfd idmap wrapper source compile/link and negative control passed')
