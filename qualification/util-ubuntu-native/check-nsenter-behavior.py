"""Probe valid nsenter operations; lack of kernel permission never qualifies.
The explicit current mount namespace leaves the intended namespace unchanged.
No capabilities, namespaces, credentials or policy are created or modified.
"""
import json,subprocess,sys
from pathlib import Path
out=Path(sys.argv[1]);mode=sys.argv[2];assert mode in ('baseline','candidate')
commands=[['nsenter','--version'],['unshare','--version'],['nsenter','--mount=/proc/self/ns/mnt','--','/usr/bin/true'],['nsenter','--mount=/proc/self/ns/mnt','--wd=/tmp','--','/usr/bin/pwd']]
results=[]
for command in commands:
    result=subprocess.run(command,capture_output=True,text=True,timeout=15)
    results.append({'argv':command,'exit_code':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
passed=(all(type(item['exit_code'])is int and item['exit_code']==0 and item['stderr']=='' for item in results)
        and results[0]['stdout']=='nsenter from util-linux 2.42.2\n'
        and results[1]['stdout']=='unshare from util-linux 2.42.2\n'
        and results[2]['stdout']=='' and results[3]['stdout']=='/tmp\n')
report={'kind':'util-nsenter-behavior','status':'behavior-passed-unadmitted' if passed else 'behavior-failed-unadmitted','native_qualified':False,'phase':mode,'kernel_namespace_entry_required':True,'results':results}
out.write_text(json.dumps(report,indent=2)+'\n')
# Baseline is diagnostic only; candidate success is mandatory, never inferred by
# comparing two permission failures. All other final gates still run separately.
if mode=='candidate' and not passed:sys.exit(1)
