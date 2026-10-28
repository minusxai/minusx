import json,re,sys,hashlib
from pathlib import Path
rows=[]
for line in Path(sys.argv[1]).read_text().splitlines():
    i=line.find('{"status":"rejected"')
    if i<0: continue
    try: obj=json.loads(line[i:])
    except ValueError: continue
    if obj not in rows: rows.append(obj)
assert len(rows)==1, "Expected one safe selected-bundle rejection receipt"
x=rows[0]
assert x["status"]=="rejected" and x["original_rule_count"]>0
assert re.fullmatch(r"[0-9a-f]{64}",x["original_profile_sha256"])
assert x["recipe_manifest_sha256"]=="b3da1b9c4ac45edbcc292aa3bb742cf19cca6b6d6629cc3df225a4eea488b155"
assert set(x)==set("status original_config_sha256 original_profile_sha256 recipe_manifest_sha256 original_rule_count result_rule_count original_seccomp_profile".split())
p=x["original_seccomp_profile"]
assert set(p)<=set("defaultAction defaultErrnoRet architectures syscalls flags".split())
assert p["defaultAction"]=="SCMP_ACT_ERRNO" and p.get("defaultErrnoRet",1)==1
source=Path(__file__).with_name("main.go").read_text()
def enums(prefix): return set(re.findall(prefix+r"[A-Z0-9_]+",source))
def number(v,maximum): return type(v) is int and 0<=v<=maximum
assert isinstance(p["architectures"],list) and 0<len(p["architectures"])<=32 and all(a in enums("SCMP_ARCH_") for a in p["architectures"])
if "flags" in p: assert isinstance(p["flags"],list) and len(p["flags"])<=8 and all(a in enums("SECCOMP_FILTER_FLAG_") for a in p["flags"])
names=set(Path(__file__).with_name("syscall-names.txt").read_text().split())
assert isinstance(p["syscalls"],list) and 0<len(p["syscalls"])<=4096
assert len(p["syscalls"])==x["original_rule_count"]
for r in p["syscalls"]:
 assert isinstance(r,dict) and set(r)<=set("names action args errnoRet".split())
 assert r["action"] in enums("SCMP_ACT_")
 assert isinstance(r["names"],list) and 0<len(r["names"])<=1024 and all(n in names for n in r["names"])
 if "personality" in r["names"]:
  assert r["names"]==["personality"] and r["action"]=="SCMP_ACT_ALLOW" and len(r.get("args",[]))==1
  a=r["args"][0];assert set(a)==set("index value op".split()) and a["index"]==0 and a["op"]=="SCMP_CMP_EQ" and a["value"] in [0,8,131072,131080,4294967295]
 if "errnoRet" in r: assert number(r["errnoRet"],4095)
 if "args" in r:
  assert isinstance(r["args"],list) and len(r["args"])<=6
  for a in r["args"]:
   assert isinstance(a,dict) and set(a)<=set("index value valueTwo op".split())
   assert number(a["index"],5) and number(a["value"],2**64-1) and a["op"] in enums("SCMP_CMP_")
   if "valueTwo" in a: assert number(a["valueTwo"],2**64-1)
canonical=json.dumps(p,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
assert hashlib.sha256(canonical).hexdigest()==x["original_profile_sha256"]
Path(sys.argv[2]).write_text(json.dumps(x,indent=2)+"\n")
