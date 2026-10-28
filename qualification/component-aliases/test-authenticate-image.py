import copy,hashlib,runpy,pathlib,unittest,contextlib,io
from unittest.mock import patch
helpers=runpy.run_path(str(pathlib.Path(__file__).with_name('authenticate-image.py')))
verify=helpers['verify']
response=helpers['response']
class Controls(unittest.TestCase):
 def data(self):
  workflow=b'public publisher source';digest='sha256:'+'a'*64;log=('pushed '+digest).encode()
  lock={'repository_id':100,'run_id':200,'attempt':1,'job_id':300,'package_version_id':400,'repository':'minusxai/minusx','source_head':'b'*40,'image_digest':digest,'package':'minusx-frontend-canary','workflow_sha256':hashlib.sha256(workflow).hexdigest(),'publisher_log_sha256':hashlib.sha256(log).hexdigest()}
  run={'id':200,'repository':{'id':100},'head_sha':'b'*40,'run_attempt':1,'status':'completed','conclusion':'success','path':'.github/workflows/publish.yml'}
  jobs={'jobs':[{'id':300,'run_attempt':1,'status':'completed','conclusion':'success','started_at':'2026-10-28T20:00:00Z','completed_at':'2026-10-28T21:00:00Z'}]}
  package={'visibility':'public','name':'minusx-frontend-canary','repository':{'id':100}}
  version={'id':400,'name':digest,'created_at':'2026-10-28T20:30:00Z','metadata':{'container':{'tags':['bbbbbbb']}}}
  return [lock,run,jobs,package,version,workflow,log]
 def test_raw_escape_bytes_captured_only(self):
  data=b'\x1b[36mknown publisher bytes\x1b[0m';output=io.StringIO()
  with patch.object(helpers['subprocess'],'check_output',return_value=data) as call,contextlib.redirect_stdout(output):
   self.assertEqual(response('repos/owner/repo/actions/jobs/1/logs',True),data)
  self.assertEqual(output.getvalue(),'')
  self.assertEqual(call.call_args.args[0],['gh','api','repos/owner/repo/actions/jobs/1/logs','--allow-escape-sequences'])
 def test_json_call_keeps_guard(self):
  with patch.object(helpers['subprocess'],'check_output',return_value=b'{"safe":true}') as call:
   self.assertEqual(response('repos/owner/repo'),{'safe':True})
  self.assertNotIn('--allow-escape-sequences',call.call_args.args[0])
 def test_raw_bytes_still_require_integrity(self):
  d=self.data();d[6]=b'\x1b[36m'+d[6]
  with self.assertRaises(AssertionError):verify(*d)
 def test_positive(self):self.assertEqual(verify(*self.data()),'ghcr.io/minusxai/minusx-frontend-canary@sha256:'+'a'*64)
 def test_negatives(self):
  mutations=[lambda d:d[0].update(attempt=True),lambda d:d[1].update(status='in_progress'),lambda d:d[1].update(conclusion='failure'),lambda d:d[1].update(head_sha='c'*40),lambda d:d[1].update(run_attempt=True),lambda d:d[2]['jobs'][0].update(run_attempt=True),lambda d:d[2]['jobs'][0].update(conclusion='failure'),lambda d:d[3].update(visibility='private'),lambda d:d[3]['repository'].update(id=999),lambda d:d[4].update(name='sha256:'+'c'*64),lambda d:d[4].update(created_at='2026-10-28T19:59:59Z'),lambda d:d[4]['metadata']['container'].update(tags=['latest']),lambda d:d.__setitem__(5,b'wrong source'),lambda d:d.__setitem__(6,b'wrong log')]
  for mutation in mutations:
   with self.subTest(mutation=mutation):
    d=copy.deepcopy(self.data());mutation(d)
    with self.assertRaises((AssertionError,StopIteration)):verify(*d)
if __name__=='__main__':unittest.main()
