"""Audit candidate: metadata-only repack of actual TARGET runtime original mount; NOT source remediation.
Never run against an unauthenticated capture. Root must approve Ubuntu three-package plan.
Original payload data and metadata preserved; only archive member names become relative.
"""
import copy,hashlib,io,json,os,re,stat,tarfile
from pathlib import Path
from email.parser import Parser
OLD='2.42.2-1ubuntu2'
NEW=OLD+'+security20261028'
METADATA_VERSION=OLD+'+metadata20261028.1'
PINNED_FILES={'paths': 'f71d68627085fc6cdd5c7f2df74d8fd1624f043fddc580811d836cdf27a72bcb', 'status': '6736f4b00504a19897d87cd9df43a550fed59fa2907b71815e1cfdaaebd2a418', 'absent-documentation': '9f4486c4844aef4b3acb108189ff10847e9fd2fc88ef0eeaa9c6e27388f29016', 'controls/md5sums': 'b9aa72e33795ab858266eed37b218af86f9b7fca2542eb7a5559d989406ecfc9', 'payload.tar': '8540b121b1a71df0d62923ddda89a1733676bc7adb66a502ae59049ca44d10d3', 'control-list': '9758202a2249d7ffba917393336c059a72640d65144f11ea2c31f9d490b23556', 'present-paths': 'a692102f47c5c92939073078d6a56cc4876157b998fad22805dc1fab115ed8e4'}
PINNED_METADATA={'paths': {'mode': 420, 'uid': 0, 'gid': 0, 'kind': 'file'}, 'status': {'mode': 420, 'uid': 0, 'gid': 0, 'kind': 'file'}, 'absent-documentation': {'mode': 420, 'uid': 0, 'gid': 0, 'kind': 'file'}, 'controls': {'mode': 493, 'uid': 0, 'gid': 0, 'kind': 'directory'}, 'controls/md5sums': {'mode': 420, 'uid': 0, 'gid': 0, 'kind': 'file'}, 'payload.tar': {'mode': 420, 'uid': 0, 'gid': 0, 'kind': 'file'}, 'control-list': {'mode': 420, 'uid': 0, 'gid': 0, 'kind': 'file'}, 'present-paths': {'mode': 420, 'uid': 0, 'gid': 0, 'kind': 'file'}}
AUTHENTICATED_RAW_ARCHIVE_SHA256='8420a323a285d6729fbac557a8429b9fe54cc28b28138b739ba395e70932ed5c'
TARGET_PROFILE_HEAD="0d797b5"
TARGET_PROFILE_RUN=40731394568

def sha(data): return hashlib.sha256(data).hexdigest()

def filesystem_metadata(original):
    return {str(p.relative_to(original)):{'mode':stat.S_IMODE(p.lstat().st_mode),'uid':p.lstat().st_uid,'gid':p.lstat().st_gid,'kind':'directory' if p.is_dir() else 'file'} for p in Path(original).rglob('*')}

def validate_metadata(observed):
    assert observed==PINNED_METADATA, 'Original capture numeric owner/mode/path closure drift'

def payload_descriptor(member, content):
    assert not member.pax_headers and not member.sparse, 'Unsupported PAX/sparse metadata'
    assert member.devmajor==0 and member.devminor==0, 'Unsupported device metadata'
    value=member.get_info()
    value.pop('chksum') # checksum necessarily changes with normalized name headers
    value['name']=value['name'].lstrip('/')
    if member.islnk(): value['linkname']=value['linkname'].lstrip('/')
    return value,sha(content) if content is not None else None

def validate(original):
    original=Path(original)
    validate_metadata(filesystem_metadata(original))
    actual={str(p.relative_to(original)):sha(p.read_bytes()) for p in original.rglob('*') if p.is_file() and not p.is_symlink()}
    assert actual==PINNED_FILES, 'Original file closure/hash drift'
    assert not any(p.is_symlink() for p in original.rglob('*')), 'Capture symlink rejected'
    raw=(original/'status').read_text(); status=Parser().parsestr(raw)
    assert status['Package']=='mount' and status['Version']==OLD
    assert status['Source']=='util-linux' and status['Architecture']=='amd64'
    assert status['Status']=='install ok installed'
    assert not status.get('Essential') and not status.get('Protected')
    assert not status.get('Provides') and not status.get('Depends') and not status.get('Conffiles')
    old='libmount1 (= '+OLD+')'; new='libmount1 (= '+NEW+')'
    assert status['Pre-Depends'].count(old)==1
    changed=raw.replace('Pre-Depends: '+status['Pre-Depends'], 'Pre-Depends: '+status['Pre-Depends'].replace(old,new))
    changed=changed.replace('Version: '+OLD+'\n','Version: '+METADATA_VERSION+'\n')
    changed=changed.replace('Source: util-linux\n','Source: util-linux ('+OLD+')\n')
    changed=changed.replace('Status: install ok installed\n','')
    final=Parser().parsestr(changed)
    assert set(final)==set(status)-{'Status'}
    for key in status:
        if key not in ('Status','Version','Source','Pre-Depends'): assert final[key]==status[key]
    data=(original/'payload.tar').read_bytes()
    # Read only: never extract absolute capture members onto the filesystem.
    # Debian package data archive member/hardlink names must be relative.
    output=io.BytesIO(); inventory=[]; expected=[]
    with tarfile.open(fileobj=io.BytesIO(data)) as archive, tarfile.open(fileobj=output,mode='w',format=tarfile.GNU_FORMAT) as destination:
        names=set(); links=[]
        for member in archive:
            name=member.name.lstrip('/')
            assert name and '..' not in Path(name).parts
            assert member.isfile() or member.isdir() or member.issym() or member.islnk()
            assert name not in names; names.add(name)
            item=copy.copy(member); item.name=name
            if member.islnk():
                item.linkname=member.linkname.lstrip('/')
                assert '..' not in Path(item.linkname).parts
                links.append(item.linkname)
            content=archive.extractfile(member).read() if member.isfile() else None
            descriptor=payload_descriptor(member,content)
            expected.append(descriptor)
            destination.addfile(item,io.BytesIO(content) if content is not None else None)
        assert all(target in names for target in links), 'Missing hardlink target'
    packaged=output.getvalue()
    with tarfile.open(fileobj=io.BytesIO(packaged)) as archive:
        for member in archive:
            content=archive.extractfile(member).read() if member.isfile() else None
            inventory.append(payload_descriptor(member,content))
    assert inventory==expected, 'Payload bytes/metadata/link preservation failed'
    return changed.encode(),packaged

def ar_member(name,data):
    assert len(name)<=15
    header=(name+'/').ljust(16)+'0'.ljust(12)+'0'.ljust(6)+'0'.ljust(6)+'100644'.ljust(8)+str(len(data)).ljust(10)+'`\n'
    return header.encode()+data+(b'\n' if len(data)%2 else b'')

def repack(original,output):
    control,data=validate(original)
    stream=io.BytesIO()
    with tarfile.open(fileobj=stream,mode='w',format=tarfile.GNU_FORMAT) as archive:
        entry=tarfile.TarInfo('./control'); entry.mode=0o644; entry.uid=entry.gid=0;entry.size=len(control)
        archive.addfile(entry,io.BytesIO(control))
        for path in sorted((Path(original)/'controls').iterdir()):
            assert path.name=='md5sums', 'Unreviewed control addition'
            info=path.lstat(); raw=path.read_bytes()
            entry=tarfile.TarInfo('./'+path.name);entry.mode=stat.S_IMODE(info.st_mode);entry.uid=info.st_uid;entry.gid=info.st_gid;entry.size=len(raw)
            archive.addfile(entry,io.BytesIO(raw))
    result=b'!<arch>\n'+ar_member('debian-binary',b'2.0\n')+ar_member('control.tar',stream.getvalue())+ar_member('data.tar',data)
    Path(output).write_bytes(result)
    return {'status':'METADATA-ONLY-UNADMITTED','source_security_fix_claim':False,'original_profile':'actual-target-runtime-0d797b5','native_qualified':False,
            'version':METADATA_VERSION,'source':'util-linux ('+OLD+')','normalized_data_tar_sha256':sha(data), 'original_payload_tar_sha256':PINNED_FILES['payload.tar'],
            'output_sha256':sha(result),'requires_explicit_three_package_root_review':True}

if __name__=='__main__':
    import sys
    assert len(sys.argv)==3
    print(json.dumps(repack(sys.argv[1],sys.argv[2]),sort_keys=True))
