"""AUDIT CANDIDATE: freeze Ubuntu3 package plan against a fresh target snapshot.
Actual target evidence/root install approval are pending. This file supplies no authorization.
Source-builder raw global status must NEVER be used as the runtime graph binding.
"""
import hashlib,importlib.util,io,json,os,re,shutil,subprocess,sys,tarfile
from pathlib import Path
from email.parser import Parser
FIELDS={'Package','Architecture','Version','Status','Essential','Protected','Multi-Arch','Pre-Depends','Depends','Recommends','Suggests','Enhances','Provides','Conflicts','Breaks','Replaces'}
FAMILY={'bsdutils','libblkid1','libmount1','libsmartcols1','libuuid1','login','mount','util-linux'}
OLD='2.42.2-1ubuntu2'
SELECTED=['libmount1','util-linux','mount']
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def parsed(path):return dict(Parser().parsestr(Path(path).read_text()).items())
def source_identity(row):
    value=row.get('Source','');match=re.fullmatch(r'([a-z0-9][a-z0-9+.-]*)(?: \(([^() ]+)\))?',value)
    assert not value or match, 'Invalid raw Source'
    return (match.group(1),match.group(2) or row['Version']) if match else (row['Package'],row['Version'])
def field_value(field,value):
    if field in {'Essential','Protected'}:
        assert value in {'','no','yes'}, 'Unsupported boolean metadata'
        return value or 'no'
    return re.sub(r'\s+',' ',value).strip()
def compare_family_status(source,target):
    assert source_identity(source)==source_identity(target), 'Target source-family identity drift'
    assert field_value('Conffiles',source.get('Conffiles',''))==field_value('Conffiles',target.get('Conffiles','')), 'Target original configuration registration drift'
    for field in FIELDS:
        assert field_value(field,source.get(field,''))==field_value(field,target.get(field,'')), ('Target source-family semantic drift',source.get('Package'),field)
def target_guard(source_original,target_original,binding,inventory):
    # Receipt must be emitted by root-reviewed parent authentication/approval driver,
    # never synthesized by this candidate or inferred from recovery/source success.
    assert binding['kind']=='ubuntu-util-runtime-target-binding'
    assert binding['status']=='root-reviewed-three-package-preparation'
    assert binding['root_approved_updated_names']==['util-linux','libmount1','mount']
    target_digest=(target_original/'resolver/raw-status.sha256').read_text().strip()
    assert re.fullmatch('[a-f0-9]{64}',target_digest)
    assert binding['target_raw_status_sha256']==target_digest
    assert binding['target_snapshot_authentication_complete'] is True
    assert binding['target_snapshot_raw_archive_sha256'] and re.fullmatch('[a-f0-9]{64}',binding['target_snapshot_raw_archive_sha256'])
    source_family=set((source_original/'resolver/installed-util-family').read_text().splitlines())
    target_family=set((target_original/'resolver/installed-util-family').read_text().splitlines())
    assert source_family==target_family==FAMILY
    for name in sorted(FAMILY):
        old,new=parsed(source_original/name/'status'),parsed(target_original/name/'status')
        assert old['Package']==new['Package']==name
        compare_family_status(old,new)
        # Exact payload interfaces/bytes/config, without forcing tar-byte or global
        # status equality across source bootstrap and actual application runtime.
        assert inventory((source_original/name/'payload.tar').read_bytes())==inventory((target_original/name/'payload.tar').read_bytes()), ('Target original payload drift',name)
        left,right=source_original/name/'controls',target_original/name/'controls'
        assert {p.name for p in left.iterdir()}=={p.name for p in right.iterdir()}
        for p in left.iterdir():
            q=right/p.name
            assert p.is_file() and q.is_file() and not p.is_symlink() and not q.is_symlink()
            assert (sha(p),p.stat().st_mode&0o7777,p.stat().st_uid,p.stat().st_gid)==(sha(q),q.stat().st_mode&0o7777,q.stat().st_uid,q.stat().st_gid), ('Target original control drift',name,p.name)
        for filename in ['absent-documentation','control-list']:
            assert (source_original/name/filename).read_bytes()==(target_original/name/filename).read_bytes()
    return target_digest

def main():
    checks,work,output,destination,target_original,binding_path=map(Path,sys.argv[1:])
    assert sha(binding_path)==os.environ.get('UTIL_UBUNTU_TARGET_BINDING_SHA256'), 'Actual authenticated target/root review binding required'
    binding=json.loads(binding_path.read_text())
    spec=importlib.util.spec_from_file_location('native_manifest',checks/'make-util-native-manifest.py')
    manifest=importlib.util.module_from_spec(spec);spec.loader.exec_module(manifest)
    target_status_sha=target_guard(work/'original',target_original,binding,manifest.inventory)
    def control(path):return dict(Parser().parsestr(subprocess.check_output(['dpkg-deb','-f',str(path)],text=True)).items())
    packages={}
    for name in SELECTED:
        original=parsed(target_original/name/'status');path=output/(name+'.deb');candidate=control(path)
        expected=original['Version']+('+metadata20261028.1' if name=='mount' else '+security20261028')
        assert candidate['Package']==name and candidate['Version']==expected
        assert candidate['Architecture']==original['Architecture']=='amd64'
        expected_source='util-linux ('+OLD+')' if name=='mount' else 'util-linux'
        assert candidate.get('Source',name)==expected_source
        packages[name]={'original_version':original['Version'],'candidate_version':candidate['Version'],'sha256':sha(path),'source':candidate.get('Source',name),'mode':'metadata-only-original-payload' if name=='mount' else 'retained-corrected-source-payload'}
    plan={'kind':'util-ubuntu-three-package-review-candidate','status':'UNADMITTED-PACKAGE-PLAN','status_sha256':target_status_sha,'architecture':'amd64','packages':packages,'target_binding_sha256':sha(binding_path),'source_builder_status_not_runtime_binding':True}
    destination.mkdir()
    (destination/'plan.json').write_text(json.dumps(plan,sort_keys=True,indent=2)+'\n')
    for name in ['runtime-payload.sha256','runtime-absent.paths','check-absence.sh','check-util-linux']:
        shutil.copy2(output/name,destination/name)
    # Root-approved package qualification only: Debian parser roundtrip; no native execution.
    ns={'__name__':'reviewed_mount_helper'};exec(compile((checks/'mount-metadata-target.py').read_text(),'<reviewed-mount-helper>','exec'),ns)
    expected_control,expected_data=ns['validate'](target_original/'mount')
    actual_data=subprocess.check_output(['dpkg-deb','--fsys-tarfile',str(output/'mount.deb')])
    assert actual_data==expected_data
    assert dict(Parser().parsestr(expected_control.decode()).items())==control(output/'mount.deb')
    with tarfile.open(fileobj=io.BytesIO(subprocess.check_output(['dpkg-deb','--ctrl-tarfile',str(output/'mount.deb')]))) as archive:
        members={m.name.removeprefix('./'):m for m in archive if not m.isdir()}
        assert set(members)=={'control','md5sums'}
        assert all(m.isfile() and m.uid==m.gid==0 and m.mode==0o644 for m in members.values())
        assert archive.extractfile(members['md5sums']).read()==(target_original/'mount/controls/md5sums').read_bytes()
    (destination/'mount-roundtrip.json').write_text(json.dumps({'status':'metadata-only-package-roundtrip-unadmitted','native_qualified':False,'data_archive_sha256':hashlib.sha256(actual_data).hexdigest(),'deb_sha256':sha(output/'mount.deb'),'original_source':'util-linux ('+OLD+')'},indent=2)+'\n')
    manifest.make(target_original,output,destination/'final-native-manifest.json')
if __name__=='__main__':main()
