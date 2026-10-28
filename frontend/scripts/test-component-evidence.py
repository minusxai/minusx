import importlib.util,json,pathlib,tempfile,types,unittest,subprocess
spec=importlib.util.spec_from_file_location('component_runner',pathlib.Path(__file__).with_name('run-component-evidence.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Controls(unittest.TestCase):
 def run_case(self,change=None,exit_code=0):
  image='sha256:'+'a'*64;cid='b'*64;calls=[]
  config={'Image':image,'Config':{'User':'0:0'},'Mounts':[],'HostConfig':{'ReadonlyRootfs':True,'NetworkMode':'none','CapDrop':['ALL'],'CapAdd':['CAP_DAC_READ_SEARCH'],'SecurityOpt':['no-new-privileges'],'Binds':None,'NanoCpus':1000000000,'Memory':1073741824,'PidsLimit':64}}
  if change:change(config)
  def checked(argv,timeout=60):
   calls.append(argv)
   if argv[1:3]==['image','inspect']:return image
   if argv[1]=='create':return cid
   if argv[1]=='inspect':return json.dumps([config])
   return ''
  m.executor.checked=checked;m.executor.command=lambda argv,timeout:types.SimpleNamespace(returncode=exit_code,stdout=json.dumps({'schema':1,'image_identity_bound':False,'source_to_binary_binding_proven':False,'package_absence_checked':False,'systemd_homed':{'component_absence_proven':False},'traversal':{'ordinary_rootfs_complete':False,'directory_symlinks_followed':False}}))
  with tempfile.TemporaryDirectory() as d:
   script=pathlib.Path(d)/'probe.cjs';script.write_text('process.stdout.write("{}")');out=pathlib.Path(d)/'out.json'
   try:m.capture('candidate',script,out,'a'*40,'b'*40)
   finally:self.assertEqual(calls[-1],['docker','rm','-f',cid])
   result=json.loads(out.read_text());self.assertEqual(result['image_id'],image);self.assertFalse(result['component_absence_admitted']);self.assertFalse(result['binary_derivation_admitted'])
   args=next(x for x in calls if x[1]=='create');self.assertNotIn('--mount',args);self.assertNotIn('--privileged',args)
 def test_actual_node_bootstrap(self):
  code=pathlib.Path(__file__).with_name('capture-component-evidence.cjs').read_text()
  with tempfile.TemporaryDirectory() as d:
   payload=code+'\nprocess.stdout.write(JSON.stringify(module.exports.inspect('+json.dumps(d)+',false))+"\\n");\n'
   result=subprocess.run(['node','-e',payload],capture_output=True,text=True,check=True)
   parsed=json.loads(result.stdout);self.assertEqual(parsed['schema'],1);self.assertFalse(parsed['source_to_binary_binding_proven'])
 def test_success(self):self.run_case()
 def test_wrong_image(self):
  with self.assertRaises(AssertionError):self.run_case(lambda c:c.update(Image='sha256:'+'c'*64))
 def test_writable(self):
  with self.assertRaises(AssertionError):self.run_case(lambda c:c['HostConfig'].update(ReadonlyRootfs=False))
 def test_extra_capability(self):
  with self.assertRaises(AssertionError):self.run_case(lambda c:c['HostConfig'].update(CapAdd=['CAP_SYS_ADMIN']))
 def test_host_mount(self):
  with self.assertRaises(AssertionError):self.run_case(lambda c:c.update(Mounts=[{}]))
 def test_nonzero(self):
  with self.assertRaises(AssertionError):self.run_case(exit_code=1)
if __name__=='__main__':unittest.main()
