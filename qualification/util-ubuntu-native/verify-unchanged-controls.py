"""Verify unchanged Ubuntu source-family controls against authenticated TARGET tar.
Caller authenticates the prepared manifest and checks its full payload paths separately.
No installs, source builds, native execution or implicit dpkg queries at import time.
"""
import hashlib,io,json,re,stat,subprocess,tarfile
from email.parser import Parser
from pathlib import Path
TARGET_RAW_SHA256='8420a323a285d6729fbac557a8429b9fe54cc28b28138b739ba395e70932ed5c'
UNCHANGED={'bsdutils','login','libblkid1','libsmartcols1','libuuid1'}
PROVIDERS={'libblkid1','libsmartcols1','libuuid1'}
SCHEMA={'kind','paths','unchanged_provider_packages','unchanged_source_family_packages','unchanged_source_family_controls','target_resolver_raw_status_sha256','native_acceptance'}

def fields(text):
    message=Parser().parsestr(text)
    assert not message.defects and len(message.keys())==len(set(message.keys()))
    return dict(message.items())

def info_owner(filename,prefixes):
    matches=[prefix for prefix in prefixes if filename.startswith(prefix+'.')]
    return max(matches,key=len) if matches else None

def installed_prefixes(current):
    return {prefix for name,row in current.items() if row.get('Status')=='install ok installed' for prefix in (name,name+':'+row['Architecture'])}

def target_reference(archive):
    data=archive if isinstance(archive,bytes) else Path(archive).read_bytes()
    assert hashlib.sha256(data).hexdigest()==TARGET_RAW_SHA256, 'Wrong authenticated target raw archive'
    result={};metadata={}
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        for member in tar:
            assert not member.name.startswith('/') and '..' not in Path(member.name).parts and str(Path(member.name))==member.name
            assert member.isdir() or member.isfile()
            assert member.name not in metadata
            metadata[member.name]={'mode':member.mode,'uid':member.uid,'gid':member.gid}
            if member.isfile():result[member.name]=tar.extractfile(member).read()
    return result,metadata

def file_metadata(path,stat_reader):
    info=stat_reader(path)
    assert stat.S_ISREG(info.st_mode) and not path.is_symlink(), 'Stored control must be regular, not symlink'
    return {'mode':stat.S_IMODE(info.st_mode),'uid':info.st_uid,'gid':info.st_gid}

def _verify_reference(manifest,archive,current,query=None,info_directory=Path('/var/lib/dpkg/info'),stat_reader=None):
    """query(argv)->str is injectable; default queries actual dpkg only when called.
    stat_reader injection is for pure metadata fixtures; production uses lstat.
    """
    assert set(manifest)==SCHEMA and manifest['kind']=='util-final-native-and-original-provider-manifest'
    assert manifest['native_acceptance'] is False
    assert set(manifest['unchanged_provider_packages'])==PROVIDERS and len(manifest['unchanged_provider_packages'])==3
    assert set(manifest['unchanged_source_family_packages'])==UNCHANGED and len(manifest['unchanged_source_family_packages'])==5
    assert set(manifest['unchanged_source_family_controls'])==UNCHANGED
    assert isinstance(manifest['paths'],dict) and manifest['paths'], 'Caller must check full original/candidate payload manifest'
    raw,numeric=target_reference(archive)
    assert manifest['target_resolver_raw_status_sha256']==raw['original/resolver/raw-status.sha256'].decode().strip()
    query=query or (lambda args:subprocess.check_output(['/usr/bin/dpkg-query',*args],text=True))
    stat_reader=stat_reader or (lambda path:path.lstat())
    info_directory=Path(info_directory);assert info_directory.is_absolute() and not info_directory.is_symlink()
    prefixes=installed_prefixes(current);checked=0;internal=0;physical_snapshot={}
    for package in sorted(UNCHANGED):
        base='original/'+package+'/'
        original=fields(raw[base+'status'].decode())
        assert current[package]==original, ('Unchanged package status/config registration drift',package)
        names=raw[base+'control-list'].decode().splitlines()
        assert len(names)==len(set(names)) and all(re.fullmatch(r'[a-z0-9][a-z0-9.-]*',name) for name in names)
        queried=set(names)-{'list','conffiles'}
        assert set(manifest['unchanged_source_family_controls'][package])==queried
        actual_names=query(['--control-list',package]).splitlines()
        assert len(actual_names)==len(set(actual_names)) and set(actual_names)==queried
        found=set()
        for name in sorted(queried):
            key=base+'controls/'+name;content=raw[key];expected={**numeric[key],'sha256':hashlib.sha256(content).hexdigest()}
            assert manifest['unchanged_source_family_controls'][package][name]==expected, ('Manifest control identity not actual numeric target',package,name)
            text=query(['--control-path',package,name]);assert text.endswith('\n') and len(text.splitlines())==1
            path=Path(text.strip());assert path.parent==info_directory and path.name.endswith('.'+name)
            prefix=path.name[:-len(name)-1];assert prefix in (package,package+':'+original['Architecture'])
            found.add(prefix)
            assert file_metadata(path,stat_reader)==numeric[key] and path.read_bytes()==content, ('Unchanged stored control drift',package,name)
            checked+=1
        assert len(found)==1 and 'md5sums' in queried
        prefix=next(iter(found));alternatives={package,package+':'+original['Architecture']}-{prefix}
        for name in alternatives:assert not any(info_owner(path.name,prefixes)==name for path in info_directory.iterdir()), ('Stale alternate dpkg prefix',name)
        declarations=[]
        for line in original.get('Conffiles','').splitlines():
            parts=line.split();assert len(parts)==2 and re.fullmatch('[a-f0-9]{32}',parts[1]), 'Unsupported original Conffiles flags/state'
            assert parts[0].startswith('/') and '..' not in Path(parts[0]).parts;declarations.append(parts[0])
        assert len(declarations)==len(set(declarations))
        expected_names=queried|{'list'}|({'conffiles'} if declarations else set())
        actual={path.name[len(prefix)+1:] for path in info_directory.iterdir() if info_owner(path.name,prefixes)==prefix}
        assert actual==expected_names, ('Unchanged physical dpkg info closure drift',package,actual,expected_names)
        listing=info_directory/(prefix+'.list')
        assert file_metadata(listing,stat_reader)=={'mode':0o644,'uid':0,'gid':0}
        # Historical capture supplies path semantics, not original internal-file bytes.
        listed=listing.read_text().splitlines();assert len(listed)==len(set(listed))
        canonical=lambda name:'/.' if name=='/' else name
        target_paths=raw[base+'paths'].decode().splitlines()
        assert len(target_paths)==len(set(target_paths))
        assert {canonical(name) for name in listed}=={canonical(name) for name in target_paths}, ('Unchanged stored list path set differs from authenticated target',package)
        internal+=1
        if declarations:
            conffiles=info_directory/(prefix+'.conffiles')
            assert file_metadata(conffiles,stat_reader)=={'mode':0o644,'uid':0,'gid':0}
            physical=conffiles.read_text().splitlines()
            assert len(physical)==len(set(physical)) and all(len(line.split())==1 for line in physical)
            assert set(physical)==set(declarations), ('Unchanged internal conffile path declarations drift',package)
            internal+=1
        physical_snapshot[package]={'prefix':prefix,'files':{name:{**file_metadata(info_directory/(prefix+'.'+name),stat_reader),'sha256':hashlib.sha256((info_directory/(prefix+'.'+name)).read_bytes()).hexdigest()} for name in sorted(expected_names)},'status_semantic_sha256':json_digest(current[package])}
    return {'kind':'ubuntu-unchanged-family-controls-verification','status':'controls-verified-native-unadmitted','packages':sorted(UNCHANGED),'queried_controls_checked':checked,'internal_files_checked':internal,'target_raw_archive_sha256':TARGET_RAW_SHA256,'native_acceptance':False,'manifest_payload_paths_must_be_verified_by_caller':True,'physical_snapshot':physical_snapshot,'conffiles_limit':'Original internal .conffiles byte order is not captured; exact registered path set, flags absence, status hash and numeric root0644 metadata are checked. No original internal byte identity claimed.'}


def json_digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def capture_before(manifest,archive,current,**kwargs):
    """Mandatory BEFORE candidate APT: validate historical reference, freeze live bytes.
    Returned baseline contains technical hashes/metadata only, no raw controls.
    Caller retains its digest independently before the installation boundary.
    """
    reference=_verify_reference(manifest,archive,current,**kwargs)
    return {'kind':'ubuntu-unchanged-family-controls-baseline','status':'captured-before-candidate-APT-unadmitted','source':'actual-fresh-runtime-before-candidate-APT','manifest_semantic_sha256':json_digest(manifest),'target_raw_archive_sha256':TARGET_RAW_SHA256,'target_resolver_raw_status_sha256':manifest['target_resolver_raw_status_sha256'],'physical_snapshot':reference['physical_snapshot'],'native_acceptance':False}

def verify_after(manifest,archive,current,baseline,expected_baseline_sha256,**kwargs):
    """Mandatory AFTER candidate APT: revalidate semantics and exact live before bytes."""
    assert set(baseline)=={'kind','status','source','manifest_semantic_sha256','target_raw_archive_sha256','target_resolver_raw_status_sha256','physical_snapshot','native_acceptance'}
    assert baseline['kind']=='ubuntu-unchanged-family-controls-baseline' and baseline['status']=='captured-before-candidate-APT-unadmitted'
    assert baseline['source']=='actual-fresh-runtime-before-candidate-APT' and baseline['native_acceptance'] is False
    assert re.fullmatch('[a-f0-9]{64}',expected_baseline_sha256) and json_digest(baseline)==expected_baseline_sha256, 'Before-APT baseline changed'
    assert baseline['manifest_semantic_sha256']==json_digest(manifest)
    assert baseline['target_raw_archive_sha256']==TARGET_RAW_SHA256 and baseline['target_resolver_raw_status_sha256']==manifest['target_resolver_raw_status_sha256']
    assert set(baseline['physical_snapshot'])==UNCHANGED
    reference=_verify_reference(manifest,archive,current,**kwargs)
    assert reference['physical_snapshot']==baseline['physical_snapshot'], 'Unchanged package physical info bytes/ordering/metadata/prefix changed across candidate APT'
    reference.pop('physical_snapshot')
    reference['kind']='ubuntu-unchanged-family-controls-before-after'
    reference['status']='exact-live-before-after-controls-preserved-native-unadmitted'
    reference['before_baseline_semantic_sha256']=expected_baseline_sha256
    reference['historical_reference_scope']='Authenticated target queried controls bytes/numeric metadata, list path semantics and status/conffile registration.'
    reference['full_internal_byte_identity_scope']='Actual freshly validated live BEFORE candidate APT versus AFTER candidate APT; hashes include ordering, numeric metadata and physical package prefix.'
    return reference

def self_test(manifest_path,archive):
    """Actual authenticated inputs with injected query/root metadata fixture only."""
    import copy,tempfile,types
    manifest=json.loads(Path(manifest_path).read_text());raw,numeric=target_reference(archive)
    current={row['Package']:row for row in (fields(block) for block in raw['original/resolver/resolver-status'].decode().split('\n\n') if block.strip())}
    # Resolver technical records omit description/conffile state; reconstruct the
    # actual unchanged-family full statuses from captured original dpkg status.
    for name in UNCHANGED:current[name]=fields(raw['original/'+name+'/status'].decode())
    records=[]
    with tempfile.TemporaryDirectory(prefix='ubuntu-unchanged-controls-') as tmp:
        info=Path(tmp);prefix_map={};control_map={}
        for package in sorted(UNCHANGED):
            base='original/'+package+'/'
            prefix=package+':amd64' if current[package].get('Multi-Arch')=='same' else package
            prefix_map[package]=prefix
            names=raw[base+'control-list'].decode().splitlines();control_map[package]=names
            for name in names:
                path=info/(prefix+'.'+name);path.write_bytes(raw[base+'controls/'+name]);path.chmod(numeric[base+'controls/'+name]['mode'])
            # Deliberately reverse actual list order: historical path semantics are
            # validated first; exact current ordering is then frozen before APT.
            listed=list(reversed(raw[base+'paths'].decode().splitlines()))
            (info/(prefix+'.list')).write_text('\n'.join(listed)+'\n');(info/(prefix+'.list')).chmod(0o644)
            declarations=[line.split()[0] for line in current[package].get('Conffiles','').splitlines() if line.strip()]
            if declarations:
                (info/(prefix+'.conffiles')).write_text('\n'.join(reversed(declarations))+'\n');(info/(prefix+'.conffiles')).chmod(0o644)
        # A legitimate longer dotted package name must not pollute login closure.
        current['login.extra']={'Package':'login.extra','Architecture':'amd64','Status':'install ok installed'}
        (info/'login.extra.md5sums').write_text('unrelated')
        def query(args):
            if args[0]=='--control-list':return '\n'.join(control_map[args[1]])+'\n'
            assert args[0]=='--control-path'
            return str(info/(prefix_map[args[1]]+'.'+args[2]))+'\n'
        def root_fixture(path):
            value=path.lstat();return types.SimpleNamespace(st_mode=value.st_mode,st_uid=0,st_gid=0)
        kw={'query':query,'info_directory':info,'stat_reader':root_fixture}
        def test(name,fn,reject=False):
            try:fn()
            except (AssertionError,KeyError,ValueError):assert reject,name
            else:assert not reject,name
            records.append({'name':name,'reject':reject,'pass':True})
        baseline=capture_before(manifest,archive,current,**kw);digest=json_digest(baseline)
        test('actual complete prepared manifest five-package before/after fixture',lambda:verify_after(manifest,archive,current,baseline,digest,**kw))
        for key,value in [('native_acceptance',True),('unchanged_source_family_packages',['login']),('unchanged_provider_packages',['libuuid1']),('target_resolver_raw_status_sha256','0'*64)]:
            changed=copy.deepcopy(manifest);changed[key]=value
            test('reject manifest '+key,lambda changed=changed:capture_before(changed,archive,current,**kw),True)
        changed=copy.deepcopy(manifest);changed['unknown']='extra'
        test('reject ignored manifest field',lambda:capture_before(changed,archive,current,**kw),True)
        changed=copy.deepcopy(manifest);changed['unchanged_source_family_controls']['login']['postinst']['uid']=501
        test('reject manifest Mac numeric owner',lambda:capture_before(changed,archive,current,**kw),True)
        target=info/(prefix_map['login']+'.postinst');saved=target.read_bytes();target.write_bytes(saved+b'drift')
        test('reject queried control bytes drift',lambda:verify_after(manifest,archive,current,baseline,digest,**kw),True);target.write_bytes(saved)
        target.chmod(0o600);test('reject control mode drift',lambda:verify_after(manifest,archive,current,baseline,digest,**kw),True);target.chmod(0o755)
        extra=info/(prefix_map['login']+'.unexpected');extra.write_text('extra')
        test('reject extra physical control',lambda:verify_after(manifest,archive,current,baseline,digest,**kw),True);extra.unlink()
        stale=info/'login:amd64.md5sums';stale.write_text('stale')
        test('reject stale alternate prefix',lambda:verify_after(manifest,archive,current,baseline,digest,**kw),True);stale.unlink()
        listing=info/(prefix_map['login']+'.list');saved=listing.read_bytes();listing.write_text('\n'.join(reversed(saved.decode().splitlines()))+'\n')
        test('reject changed live internal list ordering',lambda:verify_after(manifest,archive,current,baseline,digest,**kw),True);listing.write_bytes(saved)
        conffiles=info/(prefix_map['login']+'.conffiles');saved=conffiles.read_bytes();conffiles.write_text('\n'.join(reversed(saved.decode().splitlines()))+'\n')
        test('reject changed live conffiles ordering',lambda:verify_after(manifest,archive,current,baseline,digest,**kw),True);conffiles.write_bytes(saved)
        conffiles.write_bytes(saved+b'/etc/extra\n');test('reject changed conffile path declarations',lambda:verify_after(manifest,archive,current,baseline,digest,**kw),True);conffiles.write_bytes(saved)
        changed=copy.deepcopy(current);changed['login']['Conffiles']+=' obsolete'
        test('reject unchanged status/conffile flags drift',lambda:verify_after(manifest,archive,changed,baseline,digest,**kw),True)
        changed=copy.deepcopy(baseline);changed['physical_snapshot']['login']['prefix']='login:amd64'
        test('reject baseline tamper',lambda:verify_after(manifest,archive,current,changed,digest,**kw),True)
        test('reject wrong before digest',lambda:verify_after(manifest,archive,current,baseline,'0'*64,**kw),True)
        test('reject wrong target archive',lambda:target_reference(b'wrong'),True)
        report={'status':'PURE-MOCKED-QUERY-AND-NUMERIC-METADATA-CONTROLS-PASS','actual_manifest_sha256':hashlib.sha256(Path(manifest_path).read_bytes()).hexdigest(),'actual_target_raw_sha256':TARGET_RAW_SHA256,'controls':records,'queries_executed':'Injected fixture only; no actual dpkg command','numeric_metadata':'Injected root metadata over private fixture; no real root snapshot','package_or_native_execution':False}
    return report

def current_status(path=Path('/var/lib/dpkg/status')):
    rows=[fields(block) for block in Path(path).read_text().split('\n\n') if block.strip()]
    answer={row['Package']:row for row in rows}
    assert len(answer)==len(rows), 'Unreviewed multi-architecture duplicate Package status'
    return answer

def write_new_json(path,value):
    import os
    path=Path(path);assert not path.exists() and not path.is_symlink()
    descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600)
    with os.fdopen(descriptor,'w') as output:
        output.write(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n')

if __name__=='__main__':
    import os,sys
    if len(sys.argv)==4 and sys.argv[1]=='--self-test':
        print(json.dumps(self_test(sys.argv[2],sys.argv[3]),indent=2,sort_keys=True))
    elif len(sys.argv)==5 and sys.argv[1]=='capture':
        archive,manifest_path,before=map(Path,sys.argv[2:])
        baseline=capture_before(json.loads(manifest_path.read_text()),archive,current_status())
        write_new_json(before,baseline)
        print(json_digest(baseline))
    elif len(sys.argv)==7 and sys.argv[1]=='verify':
        archive,manifest_path,before=map(Path,sys.argv[2:5])
        expected=sys.argv[5];after=Path(sys.argv[6])
        assert re.fullmatch('[a-f0-9]{64}',expected), 'Original BEFORE capture stdout digest must be retained independently before candidate APT'
        result=verify_after(json.loads(manifest_path.read_text()),archive,current_status(),json.loads(before.read_text()),expected)
        write_new_json(after,result)
        print(json_digest(result))
    else:
        raise SystemExit('capture TARGET_TAR MANIFEST BEFORE | verify TARGET_TAR MANIFEST BEFORE EXPECTED_SHA AFTER | --self-test MANIFEST TARGET_TAR')
