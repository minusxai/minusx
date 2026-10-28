"""Generate a no-Node readonly Python resolver launcher from trusted tool runtime.
Run in disposable authenticated tool stage only; runtime target stays unmodified.
"""
import hashlib,json,pathlib,re,shlex,sys

def checked_path(value):
    assert isinstance(value,str) and re.fullmatch(r'/qualification-tools/[A-Za-z0-9_+./-]+',value)
    assert '..' not in pathlib.PurePosixPath(value).parts and str(pathlib.PurePosixPath(value))==value
    return value

def render(runtime):
    assert set(runtime)=={'loader','library_path','python','perl','inc'}, 'Unexpected runtime schema'
    loader=checked_path(runtime['loader']);python=checked_path(runtime['python']);perl=checked_path(runtime['perl'])
    assert re.fullmatch(r'/qualification-tools/(?:usr/)?lib(?:64|/x86_64-linux-gnu)/ld-linux-x86-64\.so\.2',loader)
    assert re.fullmatch(r'/qualification-tools/usr/bin/python3\.\d+',python)
    assert perl=='/qualification-tools/usr/bin/perl'
    libraries=runtime['library_path'].split(':')
    assert libraries==['/qualification-tools/usr/lib/x86_64-linux-gnu','/qualification-tools/lib/x86_64-linux-gnu']
    assert isinstance(runtime['inc'],list) and runtime['inc'] and len(runtime['inc'])==len(set(runtime['inc']))
    assert all(checked_path(path).startswith('/qualification-tools/usr/') for path in runtime['inc'])
    # -S excludes all site initialization and ambient sitecustomize; the clean
    # environment excludes PYTHONPATH/PERL*/LD_*/DYLD_*.
    # PYTHONHOME remains enabled to bind stdlib to extracted tool closure.
    command=['/usr/bin/env','-i','LC_ALL=C','PATH=/usr/bin:/bin','PYTHONHOME=/qualification-tools/usr','PYTHONNOUSERSITE=1','PYTHONDONTWRITEBYTECODE=1','DPKG_DATADIR=/qualification-tools/usr/share/dpkg',loader,'--library-path',runtime['library_path'],python,'-S']
    return '#!/bin/sh\nexec '+shlex.join(command)+' "$@"\n'

if __name__=='__main__':
    assert len(sys.argv)==4, 'runtime JSON, authenticated SHA256, output launcher required'
    path=pathlib.Path(sys.argv[1]);assert hashlib.sha256(path.read_bytes()).hexdigest()==sys.argv[2]
    result=render(json.loads(path.read_text()))
    destination=pathlib.Path(sys.argv[3]);assert not destination.exists() and not destination.is_symlink()
    destination.write_text(result);destination.chmod(0o755)
