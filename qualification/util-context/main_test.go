package main

import (
 "encoding/json"
 "os"
 "path/filepath"
 "reflect"
 "strings"
 "testing"
)
func fixture(t *testing.T) ([]byte,string,map[string]bool,map[string]bool) {
 t.Helper(); bundle:=t.TempDir(); root:=filepath.Join(bundle,"rootfs"); recipe:=filepath.Join(root,"util-linux-recipe")
 if err:=os.MkdirAll(recipe,0700);err!=nil{t.Fatal("fixture mkdir failed")}
 data:=[]byte("#!/bin/sh\nexit 0\n"); if err:=os.WriteFile(filepath.Join(recipe,"build.sh"),data,0600);err!=nil{t.Fatal("fixture write failed")}
 manifest:=[]byte(digest(data)+"  build.sh\n");os.WriteFile(filepath.Join(recipe,"SHA256SUMS"),manifest,0600)
 profile:=map[string]any{"defaultAction":"SCMP_ACT_ERRNO","defaultErrnoRet":json.Number("1"),"architectures":[]any{"SCMP_ARCH_X86_64"},"syscalls":[]any{
  map[string]any{"names":[]any{"read","write"},"action":"SCMP_ACT_ALLOW"},
  map[string]any{"names":[]any{"personality"},"action":"SCMP_ACT_ALLOW","args":[]any{map[string]any{"index":json.Number("0"),"value":json.Number("0"),"op":"SCMP_CMP_EQ"}}},
 }}
 config:=map[string]any{"ociVersion":"1.0.2","root":map[string]any{"path":"rootfs","readonly":false},"process":map[string]any{
  "args":[]any{selectedArgs[0],selectedArgs[1],selectedArgs[2]},"env":[]any{"PRIVATE_FIXTURE_ENV=do-not-log"},"capabilities":map[string]any{"bounding":[]any{"CAP_CHOWN"}},
 },"mounts":[]any{map[string]any{"destination":"/private-fixture-mount","type":"bind","source":"private-do-not-log"}},"linux":map[string]any{"namespaces":[]any{map[string]any{"type":"pid"}},"seccomp":profile}}
 return canonical(config),bundle,map[string]bool{digest(manifest):true},map[string]bool{digest(canonical(profile)):true}
}
func TestSelectedExactSinglePointer(t *testing.T){
 data,bundle,recipes,profiles:=fixture(t);result,receipt,selected,err:=mutate(data,bundle,recipes,profiles)
 if err!=nil||!selected||receipt.Status!="approved-delta"{t.Fatal("selected mutation failed")}
 before,_:=decode(data);after,_:=decode(result);linux,_:=object(after["linux"]);profile,_:=object(linux["seccomp"]);rules:=profile["syscalls"].([]any)
 if len(rules)!=3||!reflect.DeepEqual(rules[2],exactRule)||receipt.ChangedPointer!="/linux/seccomp/syscalls/2"{t.Fatal("unexpected rule delta")}
 profile["syscalls"]=rules[:2];if !reflect.DeepEqual(before,after){t.Fatal("non-profile OCI field changed")}
 encoded:=string(canonical(receipt));for _,secret:=range []string{"PRIVATE_FIXTURE_ENV","do-not-log","private-fixture-mount","CAP_CHOWN","source","mounts"}{if strings.Contains(encoded,secret){t.Fatal("receipt disclosed nonapproved context")}}
}
func TestNonselectedUnmodified(t *testing.T){
 data,bundle,recipes,profiles:=fixture(t);config,_:=decode(data);process,_:=object(config["process"]);process["args"]=[]any{"/bin/sh","-c","ordinary command"};data=append([]byte(" \n"),canonical(config)...)
 result,receipt,selected,err:=mutate(data,bundle,recipes,profiles);if err!=nil||selected||receipt.Status!="unmodified"||!reflect.DeepEqual(data,result){t.Fatal("nonselected call changed")}
}
func TestFileTamperingRejected(t *testing.T){
 data,bundle,recipes,profiles:=fixture(t);os.WriteFile(filepath.Join(bundle,"rootfs/util-linux-recipe/build.sh"),[]byte("changed"),0600)
 _,_,selected,err:=mutate(data,bundle,recipes,profiles);if err==nil||!selected{t.Fatal("tampered recipe accepted")}
}
func TestManifestTraversalRejected(t *testing.T){
 data,bundle,_,profiles:=fixture(t);manifest:=[]byte(strings.Repeat("0",64)+"  ../outside\n");os.WriteFile(filepath.Join(bundle,"rootfs/util-linux-recipe/SHA256SUMS"),manifest,0600)
 _,_,_,err:=mutate(data,bundle,map[string]bool{digest(manifest):true},profiles);if err==nil{t.Fatal("traversal accepted")}
}
func TestManifestSymlinkRejected(t *testing.T){
 data,bundle,recipes,profiles:=fixture(t);path:=filepath.Join(bundle,"rootfs/util-linux-recipe/build.sh");os.Remove(path);os.Symlink("/outside",path)
 _,_,_,err:=mutate(data,bundle,recipes,profiles);if err==nil{t.Fatal("symlink accepted")}
}
func TestUnmanifestedFileRejected(t *testing.T){
 data,bundle,recipes,profiles:=fixture(t);os.WriteFile(filepath.Join(bundle,"rootfs/util-linux-recipe/additional"),[]byte("x"),0600)
 _,_,_,err:=mutate(data,bundle,recipes,profiles);if err==nil{t.Fatal("unmanifested file accepted")}
}
func TestBroaderProfileRejectedEvenIfHashApproved(t *testing.T){
 data,bundle,recipes,_:=fixture(t);config,_:=decode(data);linux,_:=object(config["linux"]);profile,_:=object(linux["seccomp"]);rules:=profile["syscalls"].([]any);rule,_:=object(rules[1]);delete(rule,"args")
 _,_,_,err:=mutate(canonical(config),bundle,recipes,map[string]bool{digest(canonical(profile)):true});if err==nil{t.Fatal("broad personality profile accepted")}
}
func TestUnknownProfileRejected(t *testing.T){data,bundle,recipes,_:=fixture(t);_,_,_,err:=mutate(data,bundle,recipes,map[string]bool{});if err==nil{t.Fatal("unknown OCI profile accepted")}}
func TestUnknownProfileSchemaRejected(t *testing.T){
 data,bundle,recipes,_:=fixture(t);config,_:=decode(data);linux,_:=object(config["linux"]);profile,_:=object(linux["seccomp"]);profile["listenerPath"]="fixture-listener"
 _,_,_,err:=mutate(canonical(config),bundle,recipes,map[string]bool{digest(canonical(profile)):true});if err==nil{t.Fatal("unknown seccomp schema accepted")}
}
func TestDuplicateKeysRejected(t *testing.T){if _,err:=decode([]byte(`{"process":{},"process":{}}`));err==nil{t.Fatal("duplicate key accepted")}}
func TestProductionProfileExactCapture(t *testing.T){if len(approvedProfiles)!=1||!approvedProfiles["30f3f34a8336b491b755c7ab67b475d558c50a85da18190f89b78a1d42e4bd31"]{t.Fatal("source profile not exactly captured")}}
func TestBundleArgumentPassThroughSelection(t *testing.T){
 if _,ok:=bundleArgument([]string{"--version"});ok{t.Fatal("ordinary call selected")}
 if path,ok:=bundleArgument([]string{"--log","fixture","run","--bundle","fixture-bundle","id"});!ok||path!="fixture-bundle"{t.Fatal("run bundle not identified")}
}

func TestProfileExportContainsOnlySeccomp(t *testing.T){
 data,bundle,recipes,_:=fixture(t);_,r,selected,err:=mutate(data,bundle,recipes,map[string]bool{})
 if err==nil||!selected||r.OriginalSeccompProfile==nil||digest(canonical(r.OriginalSeccompProfile))!=r.OriginalProfileSHA256{t.Fatal("missing bound rejected profile")}
 raw:=string(canonical(r));for _,s:=range []string{"PRIVATE_FIXTURE_ENV","do-not-log","private-fixture-mount","CAP_CHOWN","rootfs"}{if strings.Contains(raw,s){t.Fatal("private OCI context exported")}}
}
func TestProfileExportRejectsNonTechnicalFields(t *testing.T){
 for _,kind:=range []string{"argument-private-key","argument-string","unknown-action","unknown-architecture","unsafe-name","private-name","private-flag"}{
  data,_,_,_:=fixture(t);c,_:=decode(data);l,_:=object(c["linux"]);p,_:=object(l["seccomp"]);rules:=p["syscalls"].([]any);r,_:=object(rules[0])
  switch kind{case "argument-private-key":r["args"]=[]any{map[string]any{"index":json.Number("0"),"value":json.Number("0"),"op":"SCMP_CMP_EQ","private":"hidden"}};case "argument-string":r["args"]=[]any{map[string]any{"index":json.Number("0"),"value":"hidden","op":"SCMP_CMP_EQ"}};case "unknown-action":r["action"]="private";case "unknown-architecture":p["architectures"]=[]any{"private"};case "unsafe-name":r["names"]=[]any{"/private/path"};case "private-name":r["names"]=[]any{"private_company"};case "private-flag":p["flags"]=[]any{"private_company"}}
  if safeProfile(p)==nil{t.Fatal("nontechnical profile accepted: "+kind)}
 }
}

func TestPinnedDefaultProfileNames(t *testing.T){
 data,_,_,_:=fixture(t);c,_:=decode(data);l,_:=object(c["linux"]);p,_:=object(l["seccomp"]);r,_:=object(p["syscalls"].([]any)[0]);r["names"]=[]any{"cachestat","clone3","fchmodat2","mseal","futex_wait","statmount"}
 if safeProfile(p)!=nil{t.Fatal("exact pinned BuildKit technical names rejected")}
 r["names"]=[]any{"private_company"};if safeProfile(p)==nil{t.Fatal("private string accepted")}
}

func TestControlBinaryBinding(t *testing.T){
 data,bundle,recipes,profiles:=fixture(t);c,_:=decode(data);process,_:=object(c["process"]);process["args"]=[]any{boundedControlArgs[0],boundedControlArgs[1]}
 if !exactSelection(c){t.Fatal("bounded control not selected")}
 _,_,_,err:=mutate(canonical(c),bundle,recipes,profiles);if err==nil{t.Fatal("missing control accepted")}
 root:=filepath.Join(bundle,"rootfs/qualification-controls");os.Mkdir(root,0700);os.WriteFile(filepath.Join(root,"personality-control"),[]byte("tampered"),0500)
 _,_,_,err=mutate(canonical(c),bundle,recipes,profiles);if err==nil{t.Fatal("tampered control accepted")}
 process["args"]=[]any{boundedControlArgs[0],"baseline"};raw:=canonical(c);got,_,selected,err:=mutate(raw,bundle,recipes,profiles);if err!=nil||selected||!reflect.DeepEqual(raw,got){t.Fatal("baseline controls changed")}
}
