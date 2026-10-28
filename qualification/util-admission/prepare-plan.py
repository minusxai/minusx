"""Freeze exact four-package candidate plan after package-only postprocessing."""
import hashlib,json,re,shutil,subprocess,sys,tarfile,io
from pathlib import Path
from email.parser import Parser
checks,work,output,destination=map(Path,sys.argv[1:]);destination.mkdir()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def control(path):return dict(Parser().parsestr(subprocess.check_output(['dpkg-deb','-f',str(path)],text=True)).items())
packages={}
for name in ['libmount1','util-linux','login','mount']:
    original=dict(Parser().parsestr((work/'original'/name/'status').read_text()).items())
    path=output/(name+'.deb');candidate=control(path)
    expected=(original['Version']+'+metadata20261028.1') if name=='mount' else original['Version']+'+security20261028'
    assert candidate['Package']==name and candidate['Version']==expected
    assert candidate['Architecture']==original['Architecture']=='amd64'
    expected_source={'mount':'util-linux ('+original['Version']+')','util-linux':'util-linux','libmount1':'util-linux','login':'util-linux (2.41.5-0+deb13u1+security20261028)'}[name]
    assert candidate.get('Source',name)==expected_source
    packages[name]={'original_version':original['Version'],'candidate_version':candidate['Version'],'sha256':sha(path),'source':candidate.get('Source',name),'mode':'metadata-only-original-payload' if name=='mount' else 'corrected-source-payload'}
status_sha=(work/'original/resolver/raw-status.sha256').read_text().strip();assert re.fullmatch('[a-f0-9]{64}',status_sha)
plan={'kind':'util-four-package-review-candidate','status_sha256':status_sha,'architecture':'amd64','packages':packages}
(destination/'plan.json').write_text(json.dumps(plan,sort_keys=True,indent=2)+'\n')
for name in ['runtime-payload.sha256','runtime-absent.paths','check-absence.sh','check-util-linux']:
    shutil.copy2(output/name,destination/name)
# Actual dpkg parser/extractor roundtrip of metadata-only original payload.
ns={'__name__':'reviewed_mount_helper'};exec(compile((checks/'mount-metadata-only.py').read_text(),'<reviewed-mount-helper>','exec'),ns)
expected_control,expected_data=ns['validate'](work/'original/mount')
actual_data=subprocess.check_output(['dpkg-deb','--fsys-tarfile',str(output/'mount.deb')])
assert actual_data==expected_data, 'dpkg roundtrip altered normalized original mount data archive'
assert dict(Parser().parsestr(expected_control.decode()).items())==control(output/'mount.deb')
with tarfile.open(fileobj=io.BytesIO(subprocess.check_output(['dpkg-deb','--ctrl-tarfile',str(output/'mount.deb')]))) as archive:
    members={m.name.removeprefix('./'):m for m in archive if not m.isdir()}
    assert set(members)=={'control','md5sums'}
    for name in members:
        member=members[name];assert member.isfile() and member.uid==member.gid==0 and member.mode==0o644
    assert archive.extractfile(members['md5sums']).read()==(work/'original/mount/controls/md5sums').read_bytes()
(destination/'mount-roundtrip.json').write_text(json.dumps({'status':'metadata-only-package-roundtrip-unadmitted','native_qualified':False,'data_archive_sha256':hashlib.sha256(actual_data).hexdigest(),'deb_sha256':sha(output/'mount.deb'),'original_source':'util-linux ('+packages['mount']['original_version']+')'},indent=2)+'\n')
subprocess.run(['python3',str(checks/'make-util-native-manifest.py'),str(work/'original'),str(output),str(destination/'final-native-manifest.json')],check=True)
