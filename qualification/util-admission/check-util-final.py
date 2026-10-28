"""Final native state gate; immutable manifest is authenticated by caller.
No package installation. Reject unrelated status changes and provider/payload drift.
"""
import hashlib,json,os,stat,sys,subprocess,tarfile,io,re
from email.parser import Parser
from pathlib import Path

def fields(text):
    p=Parser().parsestr(text)
    assert not p.defects and len(p.keys())==len(set(p.keys()))
    return dict(p.items())
def statuses(path):
    rows=[fields(b) for b in path.read_text().split('\n\n') if b.strip()]
    answer={r['Package']:r for r in rows}
    assert len(answer)==len(rows)
    return answer
def verify_control_file(path, member, content):
    info=path.lstat()
    assert stat.S_ISREG(info.st_mode) and not path.is_symlink()
    assert path.read_bytes()==content, 'Stored control bytes changed'
    assert (stat.S_IMODE(info.st_mode),info.st_uid,info.st_gid)==(member.mode,member.uid,member.gid)

def payload_pathset(data):
    paths=set()
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for member in archive:
            assert member.isfile() or member.isdir() or member.issym() or member.islnk()
            name=member.name.rstrip('/')
            if name.startswith('./'):name=name[2:]
            if name in ('','.'):path='/.'
            else:
                assert not name.startswith('/') and all(part not in ('','.','..') for part in name.split('/'))
                path='/'+name
            assert path not in paths, 'Duplicate candidate payload path'
            paths.add(path)
    return paths

def stored_info_closure(prefix, expected_controls, expected_paths, alternatives=()):
    for alternate in alternatives:
        assert alternate.parent==prefix.parent and alternate!=prefix
        assert not any(p.name.startswith(alternate.name+'.') for p in prefix.parent.iterdir()), 'Stale alternate package info prefix'
    actual={p.name[len(prefix.name)+1:] for p in prefix.parent.iterdir() if p.name.startswith(prefix.name+'.')}
    assert actual==set(expected_controls)|{'list'}, ('Unexpected/missing stored package control',prefix.name,sorted(actual),sorted(set(expected_controls)|{'list'}))
    path=prefix.with_name(prefix.name+'.list');info=path.lstat()
    assert stat.S_ISREG(info.st_mode) and not path.is_symlink()
    assert (stat.S_IMODE(info.st_mode),info.st_uid,info.st_gid)==(0o644,0,0)
    listed=path.read_text().splitlines()
    normalized=['/.' if name=='/' else name for name in listed]
    assert len(normalized)==len(set(normalized)), 'Duplicate generated package path'
    assert set(normalized)==expected_paths, 'Generated package path set differs from candidate'

def check(plan,before,inputs,out,debs=None):
    names={'util-linux','libmount1','login','mount'}
    assert set(plan['packages'])==names
    original=statuses(before);current=statuses(Path('/var/lib/dpkg/status'))
    assert set(original)==set(current), 'Package names changed'
    for name,old in original.items():
        new=current[name]
        if name not in names:
            assert old==new, ('Unrelated package state changed',name)
            continue
        spec=plan['packages'][name]
        assert old['Version']==spec['original_version']
        assert new['Version']==spec['candidate_version']
        assert new['Status']=='install ok installed'
        assert new.get('Source',name)==spec['source']
        assert new['Architecture']==old['Architecture']==plan['architecture']
        assert debs is not None, 'Immutable candidate archives required for complete final controls'
        assert hashlib.sha256((debs/(name+'.deb')).read_bytes()).hexdigest()==spec['sha256'], 'Candidate changed after preinstall gate'
        candidate=fields(subprocess.check_output(['dpkg-deb','-f',str(debs/(name+'.deb'))],text=True))
        assert set(new)==set(candidate)|{'Status'}|({'Conffiles'} if old.get('Conffiles') else set()), ('Unexpected final status field',name)
        normalize=lambda value: re.sub(r'\s+',' ',value).strip()
        for key,value in candidate.items():
            assert normalize(new.get(key,''))==normalize(value), ('Final candidate field changed',name,key)
        # Database-only conffile state must remain exactly original.
        assert new.get('Conffiles','')==old.get('Conffiles','')
        control_bytes=subprocess.check_output(['dpkg-deb','--ctrl-tarfile',str(debs/(name+'.deb'))])
        expected_control_names=set();control_prefixes=set();internal_controls=[]
        with tarfile.open(fileobj=io.BytesIO(control_bytes)) as archive:
            for member in archive:
                control_name=member.name.removeprefix('./')
                if member.isdir() or control_name=='control':continue
                assert member.isfile() and '/' not in control_name
                expected_control_names.add(control_name)
                content=archive.extractfile(member).read()
                if control_name=='conffiles':
                    internal_controls.append((member,content));continue
                actual_path=subprocess.check_output(['dpkg-query','--control-path',name,control_name],text=True).strip()
                actual=Path(actual_path); info=actual.lstat()
                assert actual.name.endswith('.'+control_name)
                prefix=actual.name[:-len('.'+control_name)]
                assert prefix in (name,name+':'+new['Architecture'])
                control_prefixes.add(actual.with_name(prefix))
                verify_control_file(actual,member,content)
        actual_control_names=set(subprocess.check_output(['dpkg-query','--control-list',name],text=True).splitlines())
        assert actual_control_names==expected_control_names-{'conffiles'}, ('Unexpected final queried control',name)
        assert 'md5sums' in expected_control_names and len(control_prefixes)==1
        data_archive=subprocess.check_output(['dpkg-deb','--fsys-tarfile',str(debs/(name+'.deb'))])
        prefix=next(iter(control_prefixes))
        for member,content in internal_controls:
            # dpkg 1.22.22 treats .conffiles and .list as internal database
            # files and deliberately omits both from --control-list/path.
            path=prefix.with_name(prefix.name+'.conffiles')
            verify_control_file(path,member,content)
        alternatives=[prefix.with_name(other) for other in (name,name+':'+new['Architecture']) if other!=prefix.name]
        stored_info_closure(prefix,expected_control_names,payload_pathset(data_archive),alternatives)
        for flag in ('Essential','Protected'):

            assert new.get(flag,'no')==old.get(flag,'no'), ('Changed protection flag',name,flag)
    manifest=json.loads((inputs/'final-native-manifest.json').read_text())
    assert set(manifest)=={'kind','paths','unchanged_provider_packages'}
    assert manifest['kind']=='util-final-native-and-original-provider-manifest'
    assert set(manifest['unchanged_provider_packages'])=={'libblkid1','liblastlog2-2','libsmartcols1','libuuid1'}
    for name in manifest['unchanged_provider_packages']:
        assert original[name]==current[name]
    assert manifest['paths']
    loader_checks=0
    for name,expected in manifest['paths'].items():
        path=Path(name)
        assert path.is_absolute() and '..' not in path.parts
        info=path.lstat()
        actual={'mode':stat.S_IMODE(info.st_mode),'uid':info.st_uid,'gid':info.st_gid}
        if stat.S_ISLNK(info.st_mode):actual.update(kind='link',target=os.readlink(path))
        elif stat.S_ISREG(info.st_mode):actual.update(kind='file',sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        elif stat.S_ISDIR(info.st_mode):actual.update(kind='directory')
        else:raise AssertionError('Unsupported runtime path kind')
        expected=dict(expected)
        target=expected.pop('hardlink_target',None)
        if target is not None:
            other=Path(target).stat()
            assert stat.S_ISREG(info.st_mode) and (info.st_dev,info.st_ino)==(other.st_dev,other.st_ino), ('Broken original hardlink',name)
        assert actual==expected, ('Final native/interface drift',name)
        if actual['kind']=='file' and path.open('rb').read(4)==b'\x7fELF':
            linked=subprocess.check_output(['/lib64/ld-linux-x86-64.so.2','--list',str(path)],text=True,stderr=subprocess.STDOUT)
            assert 'not found' not in linked
            loader_checks+=1
    out.write_text(json.dumps({'kind':'util-final-native-state','status':'native-gates-passed-unadmitted','candidate_names':sorted(names),'whole_status_package_count':len(current),'checked_paths':len(manifest['paths']),'actual_runtime_loader_checks':loader_checks,'manifest_sha256':hashlib.sha256((inputs/'final-native-manifest.json').read_bytes()).hexdigest()},indent=2)+'\n')
if __name__=='__main__':
    check(json.loads(Path(sys.argv[1]).read_text()),Path(sys.argv[2]),Path(sys.argv[3]),Path(sys.argv[4]),Path(sys.argv[5]))
