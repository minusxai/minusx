"""Bounded upstream regression cases and real CLI behavior for source builds."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

mode = sys.argv[1]
def run(args, **kwargs):
    return subprocess.run(args, capture_output=True, timeout=15, **kwargs)

if mode == 'coreutils':
    env = dict(os.environ, LC_ALL='C.UTF-8', _POSIX2_VERSION='200809')
    for offset in [['+0.18446744073709551615R'], ['+1', '-1.18446744073709551615R']]:
        result = run(['sort', *offset], input=b'aa\nbb\n', env=env)
        assert result.returncode == 0 and result.stdout == b'aa\nbb\n', result
    # Exact read-buffer-overrun fixture added to upstream tests/uniq/uniq.pl.
    line = '\U0001f600'.encode() + b'A' * 255 + b'\n'
    result = run(['uniq', '-w256'], input=line * 2, env=env)
    assert result.returncode == 0 and result.stdout == line, result
    result = run(['sort', '-n'], input=b'10\n2\n1\n', env=env)
    assert result.returncode == 0 and result.stdout == b'1\n2\n10\n', result
    result = run(['uniq', '-c'], input=b'a\na\nb\n', env=env)
    assert result.returncode == 0 and result.stdout.split() == [b'2', b'a', b'1', b'b'], result
elif mode == 'ncurses':
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        database = root / 'db'
        source = root / 'fixture.src'
        source.write_text('runtimefixture|bounded terminal fixture,\n cols#80, lines#24, clear=\\E[H\\E[2J, is1=x, is2=' + 'A' * 20000 + ',\n')
        result = run(['tic', '-x', '-T', '-o', str(database), str(source)])
        assert result.returncode == 0, result.stderr
        env = dict(os.environ, TERMINFO=str(database), TERM='runtimefixture')
        result = run(['infocmp', '-i', 'runtimefixture'], env=env)
        assert result.returncode == 0 and b'runtimefixture' in result.stdout, result.stderr
        result = run(['tput', 'cols'], env=env)
        assert result.returncode == 0 and result.stdout.strip() == b'80', result
        # Exercise postprocess_termcap's bounded ACS synthesis with an overlong ac string.
        termcap = root / 'fixture.cap'
        termcap.write_text('runtimecap|bounded termcap fixture:am:co#80:li#24:G2=x:ac=' + 'ab' * 2048 + ':\n')
        result = run(['tic', '-I', '-c', str(termcap)])
        assert result.returncode in (0, 1), result.stderr
else:
    raise AssertionError('Expected coreutils or ncurses')
print(mode + ' source regression and CLI integration checks passed')
