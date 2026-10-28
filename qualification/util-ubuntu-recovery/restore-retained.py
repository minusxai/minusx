"""Restore authenticated frozen inputs with numeric metadata in isolated root stage."""
import hashlib,json,os,sys,tarfile,math
from pathlib import Path
source,destination=map(Path,sys.argv[1:])
assert os.geteuid()==0 and destination.is_dir() and not list(destination.iterdir())
archive=source/'raw-work-inputs.tar'
assert hashlib.sha256(archive.read_bytes()).hexdigest()=='e43ab06f650077a4459b62f20df0ec2f603db6e3307e3a7ee549e85c431b8333'
raw=json.loads((source/'raw-input-inventory.json').read_text())
assert raw['status']=='unadmitted' and raw['metadata_accepted'] is False and raw['native_qualified'] is False
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
    original={name.removeprefix('original/'):item for name,item in observed.items() if name.startswith('original/')}
    assert original==raw['original'], 'Numeric original baseline differs from authenticated raw inventory'
    for name,spec in raw['available_debs'].items():
        assert observed[name]['sha256']==spec['sha256']
        assert len(stream.extractfile(name).read())==spec['size']
    assert len(raw['available_debs'])==8
    assert set(name.split('/')[0] for name in observed)=={'original','original-payload','baseline.json','runtime-config.h','original-features.h'}|set(raw['available_debs'])
    stream.extractall(destination,filter='fully_trusted',numeric_owner=True)
