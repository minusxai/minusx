"""Check the real configured resolver header and harmless Linux symlink paths.

No resolver definitions are injected. The fallback fixture deliberately removes
kernel-header availability after loading ordinary C prerequisites, then includes
our real header. Linux execution uses the exact source wrapper functions.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

root, output, configuration = map(Path, sys.argv[1:])
assert sys.platform == 'linux', 'Real Linux syscall qualification required'
assert configuration.is_file(), 'Actual generated runtime configuration required'
header = (root / 'include/fileutils.h').read_text()
source = (root / 'lib/fileutils.c').read_text()
wrapper = re.search(r'int ul_openat_resolve\(.*?(?=\nint ul_open_no_symlinks)', source, re.S).group()
no_symlinks = re.search(r'int ul_open_no_symlinks\(.*?\n\}', source, re.S).group()
prelude = r'''
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/syscall.h>
#include <errno.h>
#include <string.h>
#include "c.h"
'''
fallback = prelude + r'''
#undef HAVE_LINUX_OPENAT2_H
#undef RESOLVE_NO_SYMLINKS
#undef RESOLVE_BENEATH
'''
assertions = r'''
_Static_assert(RESOLVE_NO_SYMLINKS == 0x04, "Linux no-symlink ABI");
_Static_assert(RESOLVE_BENEATH == 0x08, "Linux beneath ABI");
'''
body = r'''
static void blocked(const char *path) {
    errno = 0;
    int fd = ul_open_no_symlinks(path, O_RDONLY | O_CLOEXEC, 0);
    assert(fd == -1 && errno == ELOOP);
}
int main(int argc, char **argv) {
    assert(argc == 2);
    char target[4096], ordinary[4096], magic[128];
    assert(snprintf(target, sizeof(target), "%s/target", argv[1]) > 0);
    assert(snprintf(ordinary, sizeof(ordinary), "%s/ordinary", argv[1]) > 0);
    int fd = open(target, O_CREAT | O_EXCL | O_RDWR | O_CLOEXEC, 0600);
    assert(fd >= 0);
    assert(symlink("target", ordinary) == 0);
    assert(snprintf(magic, sizeof(magic), "/proc/self/fd/%d", fd) > 0);
    int direct = ul_open_no_symlinks(target, O_RDONLY | O_CLOEXEC, 0);
    assert(direct >= 0); close(direct);
    /* Ordinary and procfd symlinks are both followed only without restrictions. */
    int a = ul_openat_resolve(AT_FDCWD, ordinary, O_RDONLY | O_CLOEXEC, 0, 0);
    int b = ul_openat_resolve(AT_FDCWD, magic, O_RDONLY | O_CLOEXEC, 0, 0);
    assert(a >= 0 && b >= 0); close(a); close(b);
    blocked(ordinary); blocked(magic);
    close(fd); assert(unlink(ordinary) == 0); assert(unlink(target) == 0);
    return 0;
}
'''
with tempfile.TemporaryDirectory(prefix='resolver-real-source-') as temporary:
    directory = Path(temporary)
    unit, binary = directory / 'resolver.c', directory / 'resolver'
    command = ['cc', '-O2', '-Wall', '-Wextra', '-Werror', '-include', str(configuration.resolve()),
               '-I', str(root), '-I', str(root / 'include')]
    def compile_text(text, success=True):
        unit.write_text(text)
        result = subprocess.run(command + [str(unit), '-o', str(binary)], capture_output=True, text=True)
        assert (result.returncode == 0) == success, result.stderr
        return result
    # Both normal configured kernel-header values and header-free fallback must
    # agree with the Linux ABI. Historical 0x02 must fail the actual same assert.
    compile_text(prelude + '#ifndef HAVE_LINUX_OPENAT2_H\n#error Actual configured Linux header required\n#endif\n#include "fileutils.h"\n' + assertions + 'int main(void) { return 0; }\n')
    compile_text(fallback + '#include "fileutils.h"\n' + assertions + 'int main(void) { return 0; }\n')
    bad = directory / 'historical-fileutils.h'
    assert header.count('# define RESOLVE_NO_SYMLINKS\t0x04') == 1
    bad.write_text(header.replace('# define RESOLVE_NO_SYMLINKS\t0x04', '# define RESOLVE_NO_SYMLINKS\t0x02'))
    negative = compile_text(fallback + '#include "' + str(bad) + '"\n' + assertions + 'int main(void) { return 0; }\n', False)
    assert 'Linux no-symlink ABI' in negative.stderr
    compile_text(prelude + '#include "fileutils.h"\n' + assertions + wrapper + no_symlinks + body)
    subprocess.run([str(binary), str(directory)], check=True, timeout=10)
report = {'generated_config_sha256': hashlib.sha256(configuration.read_bytes()).hexdigest(),
          'actual_source_wrapper': True, 'configured_header_abi': True, 'header_free_fallback_abi': True,
          'historical_wrong_flag_compile_negative_control': True,
          'regular_file_opens': True, 'unrestricted_ordinary_and_procfd_controls': True,
          'ordinary_symlink_rejected_ELOOP': True, 'procfd_magiclink_rejected_ELOOP': True,
          'resolver_constants_injected': False, 'source_sha256': {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
            for name in ['include/fileutils.h', 'lib/fileutils.c', 'include/c.h']}}
output.write_text(json.dumps(report, indent=2) + '\n')
print('Configured resolver ABI, fallback negative and ordinary/procfd symlink checks passed')
