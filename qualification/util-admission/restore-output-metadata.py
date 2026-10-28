"""Restore only authenticated output metadata lost by artifact ZIP transport."""
import hashlib,json,os,stat,sys
from pathlib import Path
root=Path(sys.argv[1]);assert os.geteuid()==0
proof=json.loads((root/'compile-proof.json').read_text())
for name,item in proof['output'].items():
    path=root/name;assert not Path(name).is_absolute() and '..' not in Path(name).parts
    assert not any(parent.is_symlink() for parent in path.parents if parent!=root.parent)
    if item['kind']=='file':
        assert path.is_file() and not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest()==item['sha256']
    elif item['kind']=='directory':assert path.is_dir() and not path.is_symlink()
    else:raise AssertionError('Unexpected output metadata kind')
    os.chown(path,item['uid'],item['gid'],follow_symlinks=False);path.chmod(item['mode'])
