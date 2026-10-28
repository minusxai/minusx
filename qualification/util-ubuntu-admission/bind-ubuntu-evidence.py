"""AUDIT CANDIDATE: bind externally authenticated Ubuntu retained/recovery/target bytes.
Root-only numeric restore and preparation receipts; no install/package build/native execution.
Never emits a completed source compile proof; original failed producer stays failed.
"""
import argparse,hashlib,importlib.util,io,json,os,re,shutil,stat,sys,tarfile,tempfile
sys.dont_write_bytecode=True
from pathlib import Path
PINS={'failed': {'raw-work-inputs.tar': 'e43ab06f650077a4459b62f20df0ec2f603db6e3307e3a7ee549e85c431b8333', 'raw-input-inventory.json': 'a9ddbabb7c05f1cfb7dc4865ca4b426975cdd6076d17e47cd2c78af1c6f0eee2', 'source-build.log': '832ca7249a85bc9d3a5196ed32acc1308bb712820c878e7203fcd77f9eb85607', 'source-suite-summary.json': '60434f9e2c009480b3ed540d42fa6bd6d8fe2734ff65975811925e377a9a3ac2', 'build-execution.json': 'e6a8840c1b0b7c4aa0b0e5d298f4a15b4c7a93c3057f186cb88b3e63d3166b3b', 'wrapper-regression.json': '5bfe4134b0f31e36ff8e413fdd3376c19f6a6b0d2ddd2093d3631994f18347b1'}, 'recovery': {'pristine-replay.json': '86e12ad066d6fd9da03298370f87a2d942782db735c2795e42c40cb5408b5b70', 'idmap-header-regression.json': 'fdf8d7c98d4abe521c4f7e2cee0e55a5fe26fb629b2a98f61ea5d8922da45c4b', 'retained-source-suite-summary.json': '60434f9e2c009480b3ed540d42fa6bd6d8fe2734ff65975811925e377a9a3ac2', 'openat-resolve-regression.json': '80d355cecbf07b17bb8163e20eb528d0944a4e52863d0aff1b230e9058f53457', 'source-regression.json': '799628398493a31eb2f0804dd486724a61c9ef237c18900acbd8605f7da84e83', 'recovery-postgates.json': '4e876f75e965ee463e4db06f176ffea027c7766218e12df3ebc706177793e0ef', 'check-util-linux': '550d524fac9b11568ebc6c51a38dcd9714c514c5ad439a18e8bdfd61c5135700'}, 'target': {'raw-work-inputs.tar': '8420a323a285d6729fbac557a8429b9fe54cc28b28138b739ba395e70932ed5c', 'pristine-comparison.json': '309beedf689d9ca8557f892c8675c1d89f5947d88b935098d4f867f0dfd77bf9', 'pristine-evidence.json': '18c1f1cb355cf98ed3d80f9717431db85769458daeb0695c66726897b7da1d9d', 'build-execution.json': '8c00f4241a52444b8bb522913af4ce542b6c64c1f1dee7407257c4e241daf316'}, 'modules': {'compare_pristine.py': '54ac897d09cc0cd47dfd7aba28fa6f2044b4a9d11133bc84062725b46a63cfdf', 'prepare-plan.py': '2568114b41b2e9dec7335f8c8136b534786800966ec6305ba43b75f6545ac0fd', 'make-util-native-manifest.py': 'e1cb796217fa96ac4e182096e482f58c00ffb5acc494cb8d24f164f2fd268105'}}
FAMILY={'bsdutils','libblkid1','libmount1','libsmartcols1','libuuid1','login','mount','util-linux'}
NAMES=['util-linux','libmount1','mount']
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def load(path):return json.loads(Path(path).read_text())
def verify_files(root,pins,closed=False):
    root=Path(root)
    if closed:assert {p.name for p in root.iterdir()}==set(pins), 'Unexpected recovery file closure'
    for name,digest in pins.items():
        path=root/name;assert path.is_file() and not path.is_symlink()
        assert sha(path)==digest, ('Authenticated input byte mismatch',name)
def module(path,pinned):
    assert sha(path)==pinned, ('Reviewed module identity mismatch',path.name)
    spec=importlib.util.spec_from_file_location('reviewed_'+path.stem.replace('-','_'),path)
    answer=importlib.util.module_from_spec(spec);spec.loader.exec_module(answer);return answer
def raw_inventory(archive,prefix):
    answer={}
    with tarfile.open(archive) as tar:
        for member in tar:
            if not member.name.startswith(prefix):continue
            name=member.name[len(prefix):];assert name and '..' not in Path(name).parts
            row={'mode':member.mode,'uid':member.uid,'gid':member.gid}
            if member.isdir():row['kind']='directory'
            elif member.isfile():row.update(kind='file',sha256=hashlib.sha256(tar.extractfile(member).read()).hexdigest())
            else:raise AssertionError('Unsupported raw archive member')
            assert name not in answer;answer[name]=row
    return answer

def restore(archive,destination,numeric):
    destination=Path(destination);destination.mkdir();directories=[];seen=set()
    with tarfile.open(archive) as tar:
        for member in tar:
            assert member.name and not member.name.startswith('/') and '..' not in Path(member.name).parts
            assert str(Path(member.name))==member.name, 'Noncanonical raw archive path'
            assert not member.pax_headers and not member.sparse and member.devmajor==member.devminor==0, 'Unsupported raw archive metadata'
            assert member.name not in seen;seen.add(member.name)
            assert member.isdir() or member.isfile(), 'No raw symlink/hardlink/device restore permitted'
            path=destination/member.name
            if member.isdir():path.mkdir(parents=True,exist_ok=True);directories.append((path,member));continue
            path.parent.mkdir(parents=True,exist_ok=True)
            descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),member.mode)
            with os.fdopen(descriptor,'wb') as output,tar.extractfile(member) as content:shutil.copyfileobj(content,output)
            if numeric:os.chown(path,member.uid,member.gid)
            os.chmod(path,member.mode)
            os.utime(path,(member.mtime,member.mtime))
            if numeric:
                info=path.lstat();assert (stat.S_IMODE(info.st_mode),info.st_uid,info.st_gid)==(member.mode,member.uid,member.gid)
    for path,member in sorted(directories,key=lambda item:len(item[0].parts),reverse=True):
        if numeric:os.chown(path,member.uid,member.gid)
        os.chmod(path,member.mode);os.utime(path,(member.mtime,member.mtime))
        if numeric:
            info=path.lstat();assert (stat.S_IMODE(info.st_mode),info.st_uid,info.st_gid)==(member.mode,member.uid,member.gid)

def verify_recovery(failed,recovery,source_work):
    verify_files(recovery,PINS['recovery'],True)
    inventory=load(failed/'raw-input-inventory.json')
    assert raw_inventory(failed/'raw-work-inputs.tar','original/')==inventory['original']
    for name,identity in inventory['available_debs'].items():
        assert sha(source_work/name)==identity['sha256'] and (source_work/name).stat().st_size==identity['size']
    assert len(inventory['available_debs'])==8
    record=load(recovery/'recovery-postgates.json')
    assert record['kind']=='ubuntu-retained-source-postgate-replay' and record['status']=='postgates-replayed-native-unadmitted'
    assert record['original_source_job_conclusion']=='failure'
    for key in ['full_util_source_recompiled','native_qualification_complete','full_source_suite_rerun','helper_executed']:assert record[key] is False
    assert record['raw_archive_sha256']==PINS['failed']['raw-work-inputs.tar']
    assert record['retained_source_log_sha256']==PINS['failed']['source-build.log']
    assert record['ordinary_fixtures']==3 and record['additional_gate_families']==['configured-idmap-header','openat-resolver']
    assert record['check_util_linux_sha256']==sha(recovery/'check-util-linux')
    context=record['context_inputs']
    assert not re.search(rb'^#define USE_LIBMOUNT_MOUNTFD_SUPPORT 1$',(source_work/'runtime-config.h').read_bytes(),re.M), 'Original Ubuntu mountfd disabled configuration required'
    for name,digest in context['source_inputs'].items():assert inventory['compiled_source_inventory'][name]['sha256']==digest
    for name,digest in context['retained_inputs'].items():assert sha(source_work/name)==digest
    assert context['generated_header_sha256']==inventory['compiled_source_inventory']['libmount/src/libmount.h']['sha256']
    assert context['header_substitutions']=={'LIBMOUNT_VERSION':'2.42.2','LIBMOUNT_MAJOR_VERSION':'2','LIBMOUNT_MINOR_VERSION':'42','LIBMOUNT_PATCH_VERSION':'2'}
    wrapper=load(failed/'wrapper-regression.json')
    for name,digest in wrapper['source_sha256'].items():assert inventory['compiled_source_inventory'][name]['sha256']==digest
    assert wrapper['mountfd_backend_defined'] is False
    for key in ['actual_source_separate_translation_units','corrected_declaration_and_definition_compile_link','historical_guard_missing_prototype_negative_control','ordinary_restricted_recursive_and_unrestricted_caller_checks','mount_syscalls_mocked']:assert wrapper[key] is True
    summary=load(recovery/'retained-source-suite-summary.json')
    assert summary==load(failed/'source-suite-summary.json')
    assert summary['kind']=='util-source-distro-suite-summary' and summary['expected_suite_count']==summary['observed_suite_count']==367
    assert summary['source_log_sha256']==sha(failed/'source-build.log')
    source=load(recovery/'source-regression.json')
    assert source['fixtures_executed']==['ordinary-cgroup-fd-lifecycle','ordinary-mount-status','ordinary-source-canonicalization']
    for name,digest in source['source_files_sha256'].items():assert context['source_inputs'][name]==digest
    header=load(recovery/'idmap-header-regression.json');resolver=load(recovery/'openat-resolve-regression.json')
    for value in [header,resolver]:
        assert value['generated_config_sha256']==context['retained_inputs']['runtime-config.h']
        for name,digest in value['source_sha256'].items():assert context['source_inputs'][name]==digest
    assert header['actual_idmap_caller_compile_and_execution'] and header['restricted_recursive_unrestricted_checks'] and header['mount_syscalls_mocked']
    assert header['fixture_supplies_configure_feature_macros'] is False and header['fixture_defines_resolve_flags'] is False
    assert header['removed_header_independent_system_definition'] is True and header['removed_header_undeclared_resolve_negative_control'] is False
    assert any(name.endswith('/fcntl.h') for name in header['independent_system_header_sha256']) and any(name.endswith('/bits/openat2.h') for name in header['independent_system_header_sha256'])
    for key in ['actual_source_wrapper','configured_header_abi','header_free_fallback_abi','historical_wrong_flag_compile_negative_control','regular_file_opens','unrestricted_ordinary_and_procfd_controls','ordinary_symlink_rejected_ELOOP','procfd_magiclink_rejected_ELOOP']:assert resolver[key] is True
    assert resolver['resolver_constants_injected'] is False
    # Bind link input to exact retained compiled libmount data bytes without loading it.
    name=next(name for name in inventory['available_debs'] if name.startswith('libmount1_'))
    data=(source_work/name).read_bytes();position=8;linked=[]
    assert data[:8]==b'!<arch>\n'
    while position<len(data):
        head=data[position:position+60];assert head[58:60]==b'`\n';size=int(head[48:58]);name=head[:16].decode().strip().rstrip('/')
        if name.startswith('data.tar'):
            with tarfile.open(fileobj=io.BytesIO(data[position+60:position+60+size]),mode='r:*') as archive:
                linked=[hashlib.sha256(archive.extractfile(m).read()).hexdigest() for m in archive if m.isfile() and m.name.endswith('/libmount.so.1.1.0')]
        position+=60+size+size%2
    assert linked==[record['library_link_input_sha256']]
    return inventory,record

def input_pins_digest():return hashlib.sha256(json.dumps(PINS,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def reviewed_preparation(receipt_path,expected_sha):
    assert receipt_path is not None and expected_sha is not None, 'External reviewed preparation receipt required; root privilege alone is not authorization'
    assert re.fullmatch('[a-f0-9]{64}',expected_sha) and sha(receipt_path)==expected_sha
    value=load(receipt_path)
    assert set(value)=={'kind','scope','root_reviewed_preparation','updated_names','installation_authorized','native_execution_authorized','input_pins_sha256'}
    assert value['kind']=='ubuntu-three-package-preparation-review' and value['scope']=='metadata-package-preparation-only'
    assert value['root_reviewed_preparation'] is True and value['updated_names']==NAMES
    assert value['installation_authorized'] is False and value['native_execution_authorized'] is False
    assert value['input_pins_sha256']==input_pins_digest()
    return value

def compare_family_without_authorization(plan,manifest,source,target):
    # Validate immutable originals without pretending there is a reviewed plan.
    for package in sorted(FAMILY):
        source_status,target_status=plan.parsed(source/package/'status'),plan.parsed(target/package/'status')
        assert plan.field_value('Conffiles',source_status.get('Conffiles',''))==plan.field_value('Conffiles',target_status.get('Conffiles','')), 'Validation-only original configuration registration drift'
        plan.compare_family_status(source_status,target_status)
        assert manifest.inventory((source/package/'payload.tar').read_bytes())==manifest.inventory((target/package/'payload.tar').read_bytes())
        left,right=source/package/'controls',target/package/'controls'
        assert {p.name for p in left.iterdir()}=={p.name for p in right.iterdir()}
        for path in left.iterdir():
            other=right/path.name
            assert path.is_file() and other.is_file() and not path.is_symlink() and not other.is_symlink()
            assert (sha(path),stat.S_IMODE(path.stat().st_mode),path.stat().st_uid,path.stat().st_gid)==(sha(other),stat.S_IMODE(other.stat().st_mode),other.stat().st_uid,other.stat().st_gid)
        for name in ['absent-documentation','control-list']:assert (source/package/name).read_bytes()==(target/package/name).read_bytes()

def process(failed,recovery,target,checks,destination,numeric,emit,review_path=None,review_sha=None):
    review=reviewed_preparation(review_path,review_sha) if emit else None
    for root,pins in [(failed,PINS['failed']),(target,PINS['target'])]:verify_files(root,pins)
    verify_files(recovery,PINS['recovery'],True)
    comparator=module(checks/'compare_pristine.py',PINS['modules']['compare_pristine.py'])
    plan=module(checks/'prepare-plan.py',PINS['modules']['prepare-plan.py'])
    manifest=module(checks/'make-util-native-manifest.py',PINS['modules']['make-util-native-manifest.py'])
    restore(failed/'raw-work-inputs.tar',destination/'work',numeric)
    restore(target/'raw-work-inputs.tar',destination/'target-work',numeric)
    work=destination/'work';original=destination/'target-work/original'
    inventory,postgates=verify_recovery(failed,recovery,work)
    source_compare=comparator.compare_pristine(work/'original');target_compare=comparator.compare_pristine(original)
    assert source_compare==load(recovery/'pristine-replay.json')
    assert target_compare==load(target/'pristine-comparison.json')
    assert set(source_compare['family_packages'])==set(target_compare['family_packages'])==FAMILY
    compare_family_without_authorization(plan,manifest,work/'original',original)
    if emit:
        binding={'kind':'ubuntu-util-runtime-target-binding','status':'root-reviewed-three-package-preparation','root_approved_updated_names':NAMES,'target_raw_status_sha256':target_compare['captured_raw_database_sha256'],'target_snapshot_authentication_complete':True,'target_snapshot_raw_archive_sha256':PINS['target']['raw-work-inputs.tar'],'native_qualified':False,'installation_authorized':False}
        plan.target_guard(work/'original',original,binding,manifest.inventory)
        authorization={'kind':'ubuntu-retained-source-package-preparation','retained_artifact_id':12827298038,'raw_archive_sha256':PINS['failed']['raw-work-inputs.tar'],'controls_sha256':'672fb67a94d433088fd16d6aa5b542429067307732346670814098de6d208d3f','original_numeric_inventory_verified':True,'all_missing_postcompile_gates_passed':True,'root_approved_updated_names':NAMES,'native_qualification_complete':False,'installation_authorized':False,'original_source_job_conclusion':'failure','completed_compile_proof_created':False,'postcompile_gate_scope':'Configured header/resolver and three ordinary source fixtures passed; API helper compiled only. Installed feature/API/native gates remain pending.','evidence_sha256':PINS,'external_review_receipt_sha256':review_sha}
    report={'kind':'ubuntu-evidence-binding-validation','status':'retained-recovery-target-validated-unadmitted','numeric_restore_performed':numeric,'preparation_records_emitted':emit,'native_qualified':False,'installation_authorized':False,'source_family_count':len(FAMILY),'source_whole_graph':source_compare['whole_graph_package_arch_count'],'target_whole_graph':target_compare['whole_graph_package_arch_count'],'source_dpkg_status_sha256':source_compare['captured_raw_database_sha256'],'target_dpkg_status_sha256':target_compare['captured_raw_database_sha256'],'input_sha256':PINS}
    if emit:
        assert numeric and os.geteuid()==0
        out=destination/'output';out.mkdir()
        for name in PINS['recovery']:shutil.copyfile(recovery/name,out/name)
        for name in ['source-build.log','wrapper-regression.json']:shutil.copyfile(failed/name,out/name)
        shutil.copyfile(recovery/'retained-source-suite-summary.json',out/'source-suite-summary.json')
        (out/'check-util-linux').chmod(0o755)
        (out/'ubuntu-recovery-authorization.json').write_text(json.dumps(authorization,sort_keys=True,indent=2)+'\n')
        shutil.copyfile(review_path,out/'external-preparation-review.json')
        (out/'target-binding.json').write_text(json.dumps(binding,sort_keys=True,indent=2)+'\n')
        (out/'evidence-binding.json').write_text(json.dumps(report,sort_keys=True,indent=2)+'\n')
        assert not list(destination.rglob('compile-proof.json')), 'Never create a successful compile proof for failed producer'
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--failed-source',type=Path,required=True);parser.add_argument('--recovery',type=Path,required=True);parser.add_argument('--target',type=Path,required=True);parser.add_argument('--checks',type=Path,required=True);parser.add_argument('--destination',type=Path);parser.add_argument('--validate-only',action='store_true');parser.add_argument('--review-authorization',type=Path);parser.add_argument('--review-authorization-sha256');args=parser.parse_args()
    if args.validate_only:
        assert args.destination is None and args.review_authorization is None and args.review_authorization_sha256 is None
        with tempfile.TemporaryDirectory(prefix='ubuntu-evidence-validation-') as temporary:result=process(args.failed_source,args.recovery,args.target,args.checks,Path(temporary),False,False)
        print(json.dumps(result,sort_keys=True))
    else:
        assert os.geteuid()==0 and args.destination is not None, 'Root-only reviewed numeric restore destination required'
        reviewed_preparation(args.review_authorization,args.review_authorization_sha256)
        assert not args.destination.exists() and not args.destination.is_symlink();args.destination.mkdir(mode=0o700)
        result=process(args.failed_source,args.recovery,args.target,args.checks,args.destination,True,True,args.review_authorization,args.review_authorization_sha256)
        print(json.dumps(result,sort_keys=True))
