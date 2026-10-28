"""Derive immutable native/provider manifest from authenticated package bytes.
Original payload archives retain numeric ownership; host extraction ownership unused.
"""
import hashlib,io,json,subprocess,sys,tarfile
from pathlib import Path
PROVIDERS={'libblkid1','liblastlog2-2','libsmartcols1','libuuid1'}
def inventory(data):
    entries={};hardlinks={};native=set()
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for member in archive:
            raw=member.name.removeprefix('./'); name='/'+raw.lstrip('/')
            assert '..' not in Path(name).parts
            if name=='/': continue
            assert name not in entries and name not in hardlinks
            row={'mode':member.mode,'uid':member.uid,'gid':member.gid}
            if member.isfile():
                content=archive.extractfile(member).read()
                row.update(kind='file',sha256=hashlib.sha256(content).hexdigest())
                if content[:4]==b'\x7fELF':native.add(name)
            elif member.issym():row.update(kind='link',target=member.linkname)
            elif member.isdir():row.update(kind='directory')
            elif member.islnk():
                target='/'+member.linkname.removeprefix('./').lstrip('/')
                assert '..' not in Path(target).parts
                hardlinks[name]=(target,row);continue
            else:raise AssertionError('Unsupported payload archive kind')
            entries[name]=row
    def resolve(name, seen):
        assert name not in seen, 'Archive hardlink cycle'
        if name in entries:
            assert entries[name]['kind']=='file', 'Hardlink target is not regular'
            return entries[name]
        assert name in hardlinks, 'Missing hardlink target'
        target,row=hardlinks[name]
        source=resolve(target,seen|{name})
        entries[name]={**row,'kind':'file','sha256':source['sha256'],'hardlink_target':target}
        if target in native:native.add(name)
        return entries[name]
    for name in hardlinks:resolve(name,set())
    # Include all regular payload bytes, scripts, configuration and links.
    return entries
def make(original,debs,destination):
    answer={}
    def add(rows):
        for name,row in rows.items():
            assert name not in answer or answer[name]==row, ('Overlapping package metadata drift',name)
            answer[name]=row
    for name in sorted(PROVIDERS|{'mount'}):add(inventory((original/name/'payload.tar').read_bytes()))
    for name in ('libmount1','util-linux','login'):
        add({p:r for p,r in inventory(subprocess.check_output(['dpkg-deb','--fsys-tarfile',str(debs/(name+'.deb'))])).items() if not p.startswith(('/usr/share/doc/','/usr/share/man/'))})
    assert answer
    destination.write_text(json.dumps({'kind':'util-final-native-and-original-provider-manifest','paths':answer,'unchanged_provider_packages':sorted(PROVIDERS)},sort_keys=True,indent=2)+'\n')
if __name__=='__main__':make(Path(sys.argv[1]),Path(sys.argv[2]),Path(sys.argv[3]))
