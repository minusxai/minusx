"""AUDIT CANDIDATE: Ubuntu3 selected updates and every other original family payload.
Original payload archives retain numeric ownership; host extraction ownership unused.
"""
import hashlib,io,json,subprocess,sys,tarfile
from pathlib import Path
PROVIDERS={'libblkid1','libsmartcols1','libuuid1'}
SELECTED={'util-linux','libmount1','mount'}
def inventory(data):
    entries={};hardlinks={};native=set()
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for member in archive:
            raw=member.name.removeprefix('./')
            assert '..' not in Path(raw).parts
            name=str(Path('/'+raw.lstrip('/')))
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
                target_raw=member.linkname.removeprefix('./')
                assert '..' not in Path(target_raw).parts
                target=str(Path('/'+target_raw.lstrip('/')))
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
    family=set((original/'resolver/installed-util-family').read_text().splitlines())
    assert family=={'bsdutils','libblkid1','libmount1','libsmartcols1','libuuid1','login','mount','util-linux'}, 'Unreviewed actual target source family'
    unchanged=family-SELECTED
    assert unchanged=={'bsdutils','libblkid1','libsmartcols1','libuuid1','login'}
    controls={}
    for name in sorted(unchanged):
        add(inventory((original/name/'payload.tar').read_bytes()))
        assert all(p.is_file() and not p.is_symlink() and p.stat().st_uid==p.stat().st_gid==0 for p in (original/name/'controls').iterdir()), 'Authenticated numeric-root controls required'
        controls[name]={p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'mode':p.stat().st_mode&0o7777,'uid':p.stat().st_uid,'gid':p.stat().st_gid} for p in (original/name/'controls').iterdir()}
    for name in ('libmount1','util-linux','mount'):
        add({p:r for p,r in inventory(subprocess.check_output(['dpkg-deb','--fsys-tarfile',str(debs/(name+'.deb'))])).items() if not p.startswith(('/usr/share/doc/','/usr/share/man/'))})
    assert answer
    destination.write_text(json.dumps({'kind':'util-final-native-and-original-provider-manifest','paths':answer,'unchanged_provider_packages':sorted(PROVIDERS),'unchanged_source_family_packages':sorted(unchanged),'unchanged_source_family_controls':controls,'target_resolver_raw_status_sha256':(original/'resolver/raw-status.sha256').read_text().strip(),'native_acceptance':False},sort_keys=True,indent=2)+'\n')
if __name__=='__main__':make(Path(sys.argv[1]),Path(sys.argv[2]),Path(sys.argv[3]))
