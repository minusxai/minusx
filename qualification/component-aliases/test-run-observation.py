import hashlib,importlib.util,json,pathlib,tempfile,types,unittest,subprocess
spec=importlib.util.spec_from_file_location('observer',pathlib.Path(__file__).with_name('run-observation.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Controls(unittest.TestCase):
 def exercise(self,change=None,exit_code=0,origin_change=None,probe_override=None):
  image_id='sha256:'+'b'*64;container='c'*64;source='d'*40;calls=[]
  image={'Id':image_id,'Architecture':'amd64','Os':'linux','Config':{'Labels':{'org.opencontainers.image.revision':source}}}
  config={'Image':image_id,'Config':{'User':'0:0'},'Mounts':[],'HostConfig':{'ReadonlyRootfs':True,'NetworkMode':'none','CapDrop':['ALL'],'CapAdd':['CAP_DAC_READ_SEARCH'],'SecurityOpt':['no-new-privileges'],'Binds':None,'NanoCpus':1000000000,'Memory':1073741824,'PidsLimit':64}}
  if change:change(image,config)
  def checked(argv,timeout=60):
   calls.append((argv,timeout))
   if argv[1:3]==['image','inspect']:return json.dumps([image])
   if argv[1]=='create':return container
   if argv[1]=='inspect':return json.dumps([config])
   return ''
  m.checked=checked;m.command=lambda argv,timeout:types.SimpleNamespace(returncode=exit_code,stdout=probe_override if probe_override is not None else json.dumps({'schema':1,'probe_uid':0,'error_count':0,'ordinary_rootfs_alias_closure_complete':True,'component_absence_proven':True,'homed_matching_entry_count':0}))
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);lock={'repository':'minusxai/minusx','package':'minusx-frontend-canary','image_digest':'sha256:'+'a'*64,'source_head':source,'run_id':1,'job_id':2};raw=json.dumps(lock).encode();(root/'lock').write_bytes(raw)
   origin={'image_ref':'ghcr.io/minusxai/minusx-frontend-canary@'+lock['image_digest'],'source_head':source,'lock_sha256':hashlib.sha256(raw).hexdigest()};
   if origin_change:origin_change(origin)
   (root/'origin').write_text(json.dumps(origin));(root/'probe').write_text('module.exports={inspectAliases:()=>({probe_uid:0})};')
   try:m.observe(root/'lock',root/'origin',root/'probe',root/'out')
   finally:
    if origin_change:self.assertEqual(calls,[])
    if probe_override is not None:self.assertFalse((root/'out').exists())
    if any(a[0][1]=='create' for a in calls):self.assertEqual(calls[-1],(['docker','rm','-f',container],15))
   result=json.loads((root/'out').read_text());self.assertEqual(result['image_id'],image_id);self.assertFalse(result['new_source_or_image_built']);self.assertFalse(result['application_deployed']);self.assertEqual(calls[0][0][:4],['docker','pull','--platform','linux/amd64'])
 def test_actual_node_entrypoint(self):
  code=pathlib.Path(__file__).with_name('alias-probe.cjs').read_text()
  with tempfile.TemporaryDirectory() as d:
   payload=code+'\nprocess.stdout.write(JSON.stringify(module.exports.inspectAliases('+json.dumps(d)+'))+"\\n");\n'
   result=subprocess.run(['node','-e',payload],capture_output=True,text=True,check=True)
   self.assertTrue(json.loads(result.stdout)['ordinary_rootfs_alias_closure_complete'])
 def test_invalid_origin_before_docker(self):
  for key,value in [('lock_sha256','f'*64),('source_head','f'*40),('image_ref','ghcr.io/wrong@sha256:'+'f'*64)]:
   with self.subTest(key=key):
    with self.assertRaises(AssertionError):self.exercise(origin_change=lambda o:o.update({key:value}))
 def test_bad_probe_uid_or_json(self):
  for value in ['{"probe_uid":false}','{"probe_uid":1001}','not JSON']:
   with self.subTest(value=value):
    with self.assertRaises((AssertionError,json.JSONDecodeError)):self.exercise(probe_override=value)
 def test_success(self):self.exercise()
 def test_mutations(self):
  mutations=[lambda i,c:i['Config']['Labels'].update({'org.opencontainers.image.revision':'e'*40}),lambda i,c:i.update(Architecture='arm64'),lambda i,c:c.update(Image='sha256:'+'f'*64),lambda i,c:c['HostConfig'].update(ReadonlyRootfs=False),lambda i,c:c['HostConfig'].update(NetworkMode='host'),lambda i,c:c['HostConfig'].update(CapAdd=['CAP_SYS_ADMIN']),lambda i,c:c.update(Mounts=[{}])]
  for mutation in mutations:
   with self.subTest(mutation=mutation):
    with self.assertRaises(AssertionError):self.exercise(mutation)
 def test_nonzero(self):
  with self.assertRaises(AssertionError):self.exercise(exit_code=1)
if __name__=='__main__':unittest.main()
