import hashlib,json,os,re,sys
from pathlib import Path
root,log=Path(sys.argv[1]),Path(sys.argv[2])
objects=[]
for line in log.read_text().splitlines():
 for marker in ['{"status":"approved-delta"','{"mode":"baseline"','{"mode":"bounded"']:
  i=line.find(marker)
  if i<0:continue
  try:x=json.loads(line[i:])
  except ValueError:continue
  if x not in objects:objects.append(x)
controls=[x for x in objects if "mode" in x]
assert {x["mode"] for x in controls}=={"baseline","bounded"} and len(controls)==2
for x in controls:
 assert set(x)=={"mode","passed","calls","checks"} and x["passed"] is True
 checks=[(q["mask"],q["errno"]) for q in x["checks"]]
 expected=[(4294967295,0),(268173312,1),(267911168,1),(536608768,1)] if x["mode"]=="baseline" else [(4294967295,0),(268173312,0),(0,0),(267911168,1),(536608768,1)]
 assert checks==expected and x["calls"]==len(expected)
receipts=[x for x in objects if "status" in x]
assert len(receipts)==2
profile_hash="30f3f34a8336b491b755c7ab67b475d558c50a85da18190f89b78a1d42e4bd31"
rule={"names":["personality"],"action":"SCMP_ACT_ALLOW","args":[{"index":0,"value":268173312,"op":"SCMP_CMP_EQ"}]}
recipe={"debian":"b3da1b9c4ac45edbcc292aa3bb742cf19cca6b6d6629cc3df225a4eea488b155","ubuntu":"531c0bf85fd7cada6cbed1eae728efcc892d4805c4e28d5f2e4f5636b6a47982"}[os.environ["QUALIFICATION_OS"]]
canon=lambda x:json.dumps(x,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
for x in receipts:
 assert x["status"]=="approved-delta" and x["recipe_manifest_sha256"]==recipe
 assert x["original_profile_sha256"]==profile_hash and x["original_rule_count"]==13 and x["result_rule_count"]==14
 assert x["added_rule"]==rule and x["changed_json_pointer"]=="/linux/seccomp/syscalls/13"
 profile=x["original_seccomp_profile"]
 assert hashlib.sha256(canon(profile)).hexdigest()==profile_hash
 profile["syscalls"].append(rule)
 assert hashlib.sha256(canon(profile)).hexdigest()==x["result_profile_sha256"]
for name in ["source-build.log","source-regression.json","idmap-header-regression.json","runtime-payload.sha256","runtime-absent.paths","check-absence.sh","check-util-linux","libmount1.deb","util-linux.deb"]:assert (root/name).is_file(),"Missing required source output"
if os.environ["QUALIFICATION_OS"]=="debian":assert (root/"login.deb").is_file()
else:assert (root/"wrapper-regression.json").is_file()
files={}
for f in sorted(root.rglob("*")):
 assert not f.is_symlink(),"Unexpected output symlink"
 if f.is_file():files[str(f.relative_to(root))]={"sha256":hashlib.sha256(f.read_bytes()).hexdigest(),"size":f.stat().st_size}
proof={"kind":"util-source-qualification","source_head":os.environ["SOURCE_HEAD"],"run_id":int(os.environ["RUN_ID"]),"run_attempt":int(os.environ["RUN_ATTEMPT"]),"os":os.environ["QUALIFICATION_OS"],"recipe_manifest_sha256":recipe,"original_profile_sha256":profile_hash,"single_added_rule":rule,"controls":controls,"source_build_and_installed_gates":"completed successfully under unchanged recipe","full_build_log_sha256":hashlib.sha256(log.read_bytes()).hexdigest(),"files":files}
(root/"qualification.json").write_text(json.dumps(proof,indent=2)+"\n")
