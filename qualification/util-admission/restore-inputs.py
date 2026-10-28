"""Restore authenticated frozen inputs with numeric metadata in isolated root stage."""
import hashlib,json,os,sys,tarfile,math
from pathlib import Path
source,destination=map(Path,sys.argv[1:])
assert os.geteuid()==0 and destination.is_dir() and not list(destination.iterdir())
proof=json.loads((source/'compile-proof.json').read_text())
archive=source/'compile-inputs.tar'
assert hashlib.sha256(archive.read_bytes()).hexdigest()==proof['compile_inputs_archive_sha256']
with tarfile.open(archive) as stream:
    members=stream.getmembers();names=set();links=set()
    for member in members:
        path=Path(member.name)
        assert not path.is_absolute() and '..' not in path.parts
        normalized=str(path)
        assert normalized not in names;names.add(normalized)
        assert member.isdir() or member.isfile(), 'This frozen input schema permits only regular files/directories'
        assert set(member.pax_headers)<= {'mtime'} and not member.sparse
        if 'mtime' in member.pax_headers: assert math.isfinite(float(member.pax_headers['mtime']))
        if member.issym():links.add(normalized)
    for member in members:
        path=Path(member.name)
        assert not {str(parent) for parent in path.parents}&links, 'Archive path traverses symlink'
        if member.islnk():
            target=Path(member.linkname)
            assert not target.is_absolute() and '..' not in target.parts and str(target) in names
            assert not ({str(target)}|{str(parent) for parent in target.parents})&links
    observed={}
    for member in members:
        name=str(Path(member.name))
        if name=='.':continue
        item={'mode':member.mode,'uid':member.uid,'gid':member.gid,'kind':'directory' if member.isdir() else 'file'}
        if member.isfile():item['sha256']=hashlib.sha256(stream.extractfile(member).read()).hexdigest()
        observed[name]=item
    assert observed==proof['export'], 'Authenticated numeric archive inventory differs from proof'
    stream.extractall(destination,filter='fully_trusted',numeric_owner=True)
