#!/usr/bin/env python3
"""Exercise image binding and permission-scan orchestration without Docker."""
import copy
import importlib.util
import json
import pathlib
import subprocess
import tempfile

spec=importlib.util.spec_from_file_location('inventory',pathlib.Path(__file__).with_name('run-glibc-inventory.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
IMAGE='sha256:'+'a'*64
BASE={'schema':2,'probeUid':0,'expectedImageId':IMAGE,'identityBinding':'host-bound','counters':{'regularFiles':10,'elfFiles':1,'setidFiles':0,'originCandidates':0},'elfClasses':{'64':1},'namedPayload':{},'setuidCount':0,'setgidCount':0,'setidOriginCount':0,'setidOriginTraversalCount':0,'originTraversalCount':0,'privateInventorySha256':'b'*64,'errorCount':0,'errorKinds':{},'permissionErrors':{},'scanComplete':True,'capabilityCoverage':'unknown','limitations':[]}
CASES=['success','wrong-image','extra-cap','host-mount','writable','network','protected-uid','protected-errors','protected-exit','standard-parser','boolean-count','private-field','private-permission']
for case in CASES:
    calls=[];created={};removed=[]
    def fake(argv,timeout=60):
        calls.append(argv);output='';code=0
        if argv[:3]==['docker','image','inspect']:
            output=IMAGE+'\n'
        elif argv[:2]==['docker','create']:
            assert '--mount' not in argv and '--privileged' not in argv
            assert argv[argv.index('--cap-drop')+1]=='ALL' and argv[argv.index('--network')+1]=='none'
            protected='--cap-add' in argv
            if protected:assert argv[argv.index('--cap-add')+1]=='DAC_READ_SEARCH' and argv[argv.index('--user')+1]=='0:0'
            assert argv[-3]==IMAGE and argv[-2]=='-e'
            owned=format(len(created)+1,'064x');created[owned]=protected;output=owned+'\n'
        elif argv[:2]==['docker','inspect']:
            protected=created[argv[-1]]
            host={'ReadonlyRootfs':True,'NetworkMode':'none','CapDrop':['ALL'],'CapAdd':['CAP_DAC_READ_SEARCH'] if protected else None,'SecurityOpt':['no-new-privileges'],'Binds':None,'NanoCpus':1000000000,'Memory':1073741824,'PidsLimit':64}
            row={'Image':IMAGE,'HostConfig':host,'Mounts':[],'Config':{'User':'0:0' if protected else ''}}
            if protected:
                if case=='wrong-image':row['Image']='sha256:'+'c'*64
                if case=='extra-cap':host['CapAdd'].append('CAP_SYS_ADMIN')
                if case=='host-mount':row['Mounts']=[{'Source':'private-must-not-export'}]
                if case=='writable':host['ReadonlyRootfs']=False
                if case=='network':host['NetworkMode']='bridge'
            output=json.dumps([row])
        elif argv[:2]==['docker','start']:
            protected=created[argv[-1]];probe=copy.deepcopy(BASE)
            if not protected:
                probe.update(errorCount=2,errorKinds={'EACCES':2},permissionErrors={'directory:700:other':2},scanComplete=False);code=1
                if case=='standard-parser':probe['errorKinds']={'ELF_BOUNDS':2}
            else:
                if case=='protected-uid':probe['probeUid']=1001
                if case=='protected-errors':probe.update(errorCount=1,errorKinds={'EACCES':1},scanComplete=False)
                if case=='protected-exit':code=1
                if case=='boolean-count':probe['errorCount']=False
                if case=='private-field':probe['rawPath']='private-must-not-export'
                if case=='private-permission':probe['permissionErrors']={'private-must-not-export':1}
            output=json.dumps(probe)
        elif argv[:3]==['docker','rm','-f']:
            removed.append(argv[-1])
        else:raise AssertionError(argv)
        return subprocess.CompletedProcess(argv,code,stdout=output,stderr='')
    module.command=fake
    with tempfile.TemporaryDirectory() as temp:
        script=pathlib.Path(temp)/'probe.cjs';script.write_text('// public script\n');out=pathlib.Path(temp)/'out.json'
        try:module.inventory('runtime-check',script,out,'d'*40,'e'*40)
        except AssertionError:
            assert case!='success'
            if out.exists():assert json.loads(out.read_text())['inventory_status']=='cap-free-only-unadmitted'
        else:
            assert case=='success';proof=json.loads(out.read_text());assert proof['probe']['scanComplete'] is True and proof['cap_free_diagnostic']['scanComplete'] is False
            assert proof['inventory_status']=='complete-inventory' and proof['inventory_capability']=='CAP_DAC_READ_SEARCH'
            assert 'private-must-not-export' not in out.read_text()
    assert set(removed)==set(created)
print(f'{len(CASES)} image/capability/permission/privacy/failure/cleanup controls PASS (Docker mocked)')
