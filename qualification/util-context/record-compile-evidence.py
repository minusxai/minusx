import hashlib,json,os,re,sys,stat,tarfile
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
recipe={"debian":"a3e99174686040364a196bd66bf8b1e991a9ac0d09f85744a49b4269b131d041","ubuntu":"2fee7e8c9bb660064c8138a06bb2208bc19e5a67abb0a375c92b58284cf40421"}[os.environ["QUALIFICATION_OS"]]
canon=lambda x:json.dumps(x,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
for x in receipts:
 assert x["status"]=="approved-delta" and x["recipe_manifest_sha256"]==recipe
 assert x["original_profile_sha256"]==profile_hash and x["original_rule_count"]==13 and x["result_rule_count"]==14
 assert x["added_rule"]==rule and x["changed_json_pointer"]=="/linux/seccomp/syscalls/13"
 profile=x["original_seccomp_profile"]
 assert hashlib.sha256(canon(profile)).hexdigest()==profile_hash
 profile["syscalls"].append(rule)
 assert hashlib.sha256(canon(profile)).hexdigest()==x["result_profile_sha256"]

proof_path=root/"compile-proof.json"
proof=json.loads(proof_path.read_text())
proof_sha=hashlib.sha256(proof_path.read_bytes()).hexdigest()
assert (root/"compile-proof.sha256").read_text()==proof_sha+"  compile-proof.json\n"
assert proof["kind"]=="util-source-compile-inputs" and proof["status"]=="compile-only-unadmitted" and proof["installed_native_qualification"] is False
assert hashlib.sha256(proof["recipe_manifest"].encode()).hexdigest()==recipe
assert proof["recipe"]["SHA256SUMS"]["sha256"]==recipe
assert proof["compiled_source_inventory"] and proof["selected_compiled_packages"]
assert set(proof["selected_compiled_packages"])==({"libmount1","util-linux","login"} if os.environ["QUALIFICATION_OS"]=="debian" else {"libmount1","util-linux"})
def safe_path(name):
 p=Path(name)
 assert name and not p.is_absolute() and ".." not in p.parts and str(p)==name
 return p
def check_local(base,inventory):
 for name,item in inventory.items():
  f=base/safe_path(name)
  assert not f.is_symlink(),"Unexpected transport symlink"
  assert stat.S_IMODE(f.stat().st_mode)==item["mode"]
  if item["kind"]=="file":assert f.is_file() and hashlib.sha256(f.read_bytes()).hexdigest()==item["sha256"]
  else:assert item["kind"]=="directory" and f.is_dir()
check_local(root,proof["output"])
check_local(root/"compile-inputs",proof["export"])
archive=root/"compile-inputs.tar"
assert hashlib.sha256(archive.read_bytes()).hexdigest()==proof["compile_inputs_archive_sha256"]
# Archive records, unlike ZIP/local-export ownership, preserve numeric IDs.
seen={}
with tarfile.open(archive) as ar:
 for m in ar:
  name=m.name.removeprefix("./")
  if name==".":continue
  safe_path(name);assert name not in seen
  item={"mode":m.mode,"uid":m.uid,"gid":m.gid}
  if m.isdir():item["kind"]="directory"
  else:
   assert m.isfile(),"Unsupported archived input"
   item.update(kind="file",sha256=hashlib.sha256(ar.extractfile(m).read()).hexdigest())
  seen[name]=item
assert seen==proof["export"]
assert all(proof["export"][name]==item for name,item in proof["work"].items())
expected_paths=set(proof["output"])|{"compile-inputs","compile-inputs.tar","compile-proof.json","compile-proof.sha256"}|{"compile-inputs/"+n for n in proof["export"]}
actual_paths={str(f.relative_to(root)) for f in root.rglob("*")}
assert actual_paths==expected_paths,"Unexpected or missing compilation output"
controls=json.loads((root/"compiled-package-controls.json").read_text())
assert set(controls)==set(proof["selected_compiled_packages"])
for name in controls:
 assert set(controls[name])=={"original","rebuilt"}
 assert controls[name]["original"]["Package"]==name and controls[name]["rebuilt"]["Package"]==name
 assert "Pre-Depends" in controls[name]["original"] and "Pre-Depends" in controls[name]["rebuilt"]
files={str(f.relative_to(root)):{"sha256":hashlib.sha256(f.read_bytes()).hexdigest(),"size":f.stat().st_size} for f in sorted(root.rglob("*")) if f.is_file()}
record={"kind":"util-compile-evidence","status":"compile-only-unadmitted","installed_native_qualification":False,"source_head":os.environ["SOURCE_HEAD"],"run_id":int(os.environ["RUN_ID"]),"run_attempt":int(os.environ["RUN_ATTEMPT"]),"os":os.environ["QUALIFICATION_OS"],"recipe_manifest_sha256":recipe,"compile_proof_sha256":proof_sha,"original_profile_sha256":profile_hash,"single_added_rule":rule,"controls":controls,"kernel_controls":[x for x in objects if "mode" in x],"files":files,"log_sha256":hashlib.sha256(log.read_bytes()).hexdigest()}
(root/"compile-evidence.json").write_text(json.dumps(record,indent=2)+"\n")
