// Audit-only candidate. The production profile lock is deliberately empty.
package main

import (
 "bytes"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "os"
 "path/filepath"
 "reflect"
 _ "embed"
 "strconv"
 "strings"
 "syscall"
)

//go:embed syscall-names.txt
var syscallNames string

const realRuntime = "/usr/bin/buildkit-runc.real"
const recipePath = "/util-linux-recipe"
const manifestLimit = 1024 * 1024
const configLimit = 16 * 1024 * 1024
const personalityValue = 268173312

var approvedRecipes = map[string]bool{
 "b3da1b9c4ac45edbcc292aa3bb742cf19cca6b6d6629cc3df225a4eea488b155": true,
 "531c0bf85fd7cada6cbed1eae728efcc892d4805c4e28d5f2e4f5636b6a47982": true,
}
// Filled only after root reviews the exact generated OCI default profile.
// An empty set means selected bundles can never be mutated or executed.
var approvedProfiles = map[string]bool{}

var selectedArgs = []string{"/bin/sh", "-c", "sh /util-linux-recipe/build.sh"}
var exactRule = map[string]any{
 "names": []any{"personality"}, "action": "SCMP_ACT_ALLOW",
 "args": []any{map[string]any{"index": json.Number("0"), "value": json.Number("268173312"), "op": "SCMP_CMP_EQ"}},
}

type Receipt struct {
 Status string `json:"status"`
 OriginalConfigSHA256 string `json:"original_config_sha256,omitempty"`
 ResultConfigSHA256 string `json:"result_config_sha256,omitempty"`
 OriginalProfileSHA256 string `json:"original_profile_sha256,omitempty"`
 ResultProfileSHA256 string `json:"result_profile_sha256,omitempty"`
 RecipeManifestSHA256 string `json:"recipe_manifest_sha256,omitempty"`
 OriginalRuleCount int `json:"original_rule_count"`
 ResultRuleCount int `json:"result_rule_count"`
 AddedRule any `json:"added_rule,omitempty"`
 OriginalSeccompProfile map[string]any `json:"original_seccomp_profile,omitempty"`
 ChangedPointer string `json:"changed_json_pointer,omitempty"`
}
func digest(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func canonical(value any) []byte { data, err := json.Marshal(value); if err != nil { panic(err) }; return data }

// Reject duplicate object keys before decoding; never reinterpret ambiguous OCI JSON.
func uniqueValue(dec *json.Decoder) error {
 token, err := dec.Token(); if err != nil { return err }
 delim, container := token.(json.Delim); if !container { return nil }
 switch delim {
 case '{':
  seen := map[string]bool{}
  for dec.More() {
   keyToken, err := dec.Token(); if err != nil { return err }
   key, ok := keyToken.(string); if !ok || seen[key] { return errors.New("duplicate or invalid JSON key") }; seen[key] = true
   if err := uniqueValue(dec); err != nil { return err }
  }
 case '[':
  for dec.More() { if err := uniqueValue(dec); err != nil { return err } }
 default: return errors.New("invalid JSON container")
 }
 _, err = dec.Token(); return err
}
func decode(data []byte) (map[string]any, error) {
 if len(data) > configLimit { return nil, errors.New("oversized OCI document") }
 validator := json.NewDecoder(bytes.NewReader(data)); validator.UseNumber()
 if err := uniqueValue(validator); err != nil { return nil, err }
 if _, err := validator.Token(); err != io.EOF { return nil, errors.New("trailing JSON data") }
 decoder := json.NewDecoder(bytes.NewReader(data)); decoder.UseNumber()
 var value map[string]any; if err := decoder.Decode(&value); err != nil { return nil, err }; return value, nil
}
func object(value any) (map[string]any, bool) { result, ok := value.(map[string]any); return result, ok }
func exactSelection(config map[string]any) bool {
 process, ok := object(config["process"]); if !ok { return false }
 args, ok := process["args"].([]any); if !ok || len(args) != len(selectedArgs) { return false }
 for index, value := range args { if value != selectedArgs[index] { return false } }; return true
}
func readLimited(path string, maximum int64) ([]byte, error) {
 file, err := os.Open(path); if err != nil { return nil, err }; defer file.Close()
 info, err := file.Stat(); if err != nil || !info.Mode().IsRegular() || info.Size() > maximum { return nil, errors.New("invalid regular file") }
 data, err := io.ReadAll(io.LimitReader(file, maximum+1)); if err != nil || int64(len(data)) > maximum { return nil, errors.New("file read limit exceeded") }; return data, nil
}
func within(root, path string) bool { relative, err := filepath.Rel(root, path); return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator)) && !filepath.IsAbs(relative) }
func noSymlinkPath(root, relative string) (string, error) {
 if relative == "" || filepath.IsAbs(relative) || filepath.Clean(relative) != relative || relative == "." || strings.Contains(relative, "\\") { return "", errors.New("invalid relative recipe path") }
 current := root
 for _, component := range strings.Split(relative, "/") {
  if component == ".." || component == "." || component == "" { return "", errors.New("recipe path traversal") }
  current = filepath.Join(current, component)
  info, err := os.Lstat(current); if err != nil || info.Mode()&os.ModeSymlink != 0 { return "", errors.New("recipe symlink or unavailable path") }
 }
 if !within(root, current) { return "", errors.New("recipe path escapes root") }; return current, nil
}
func verifyRecipe(rootfs string, approved map[string]bool) (string, error) {
 // Resolve the trusted bundle root once, then reject every symlink in recipe paths.
 root, err := filepath.EvalSymlinks(rootfs); if err != nil { return "", errors.New("unavailable bundle root") }
 root, err = filepath.Abs(root); if err != nil { return "", err }
 recipe, err := noSymlinkPath(root, strings.TrimPrefix(recipePath, "/")); if err != nil { return "", err }
 manifest, err := noSymlinkPath(recipe, "SHA256SUMS"); if err != nil { return "", err }
 data, err := readLimited(manifest, manifestLimit); if err != nil { return "", err }
 hash := digest(data); if !approved[hash] { return hash, errors.New("recipe manifest not approved") }
 seen := map[string]bool{}
 for _, line := range strings.Split(strings.TrimSuffix(string(data), "\n"), "\n") {
  if len(line) < 67 || line[64:66] != "  " { return hash, errors.New("invalid SHA256 manifest format") }
  expected, name := line[:64], line[66:]
  decoded, err := hex.DecodeString(expected); if err != nil || len(decoded) != 32 || expected != strings.ToLower(expected) || seen[name] || name == "SHA256SUMS" { return hash, errors.New("invalid or duplicate manifest entry") }
  seen[name] = true
  path, err := noSymlinkPath(recipe, name); if err != nil { return hash, err }
  actual, err := readLimited(path, configLimit); if err != nil || digest(actual) != expected { return hash, errors.New("recipe file checksum mismatch") }
 }
 if !seen["build.sh"] || len(seen) == 0 { return hash, errors.New("missing recipe entry point") }
 // No unmanifested files or symlinks may alter recipe execution.
 err = filepath.WalkDir(recipe, func(path string, entry os.DirEntry, err error) error {
  if err != nil { return err }; if path == recipe { return nil }
  if entry.Type()&os.ModeSymlink != 0 { return errors.New("unmanifested recipe symlink") }
  if entry.IsDir() { return nil }; relative, err := filepath.Rel(recipe, path); if err != nil { return err }
  if relative != "SHA256SUMS" && !seen[relative] { return errors.New("unmanifested recipe file") }; return nil
 }); return hash, err
}
func validateProfile(profile map[string]any) ([]any, error) {
 allowed := map[string]bool{"defaultAction":true,"defaultErrnoRet":true,"architectures":true,"syscalls":true,"flags":true}
 for key := range profile { if !allowed[key] { return nil, errors.New("unsupported seccomp schema") } }
 if profile["defaultAction"] != "SCMP_ACT_ERRNO" { return nil, errors.New("seccomp default is not deny") }
 if errno, exists := profile["defaultErrnoRet"]; exists && errno != json.Number("1") { return nil, errors.New("unexpected seccomp errno") }
 rules, ok := profile["syscalls"].([]any); if !ok || len(rules) == 0 { return nil, errors.New("missing seccomp rules") }
 for _, raw := range rules {
  rule, ok := object(raw); if !ok { return nil, errors.New("invalid seccomp rule") }
  for key := range rule { if key != "names" && key != "action" && key != "args" && key != "errnoRet" { return nil, errors.New("unsupported seccomp rule field") } }
  names, ok := rule["names"].([]any); if !ok || len(names) == 0 { return nil, errors.New("invalid syscall names") }
  personality := false
  for _, name := range names { text, ok := name.(string); if !ok { return nil, errors.New("invalid syscall name") }; if text == "personality" { personality = true } }
  if !personality { continue }
  if len(names) != 1 || rule["action"] != "SCMP_ACT_ALLOW" { return nil, errors.New("unexpected personality rule") }
  args, ok := rule["args"].([]any); if !ok || len(args) != 1 { return nil, errors.New("broad personality allowance") }
  arg, ok := object(args[0]); if !ok || len(arg) != 3 || arg["index"] != json.Number("0") || arg["op"] != "SCMP_CMP_EQ" { return nil, errors.New("unexpected personality argument schema") }
  switch arg["value"] { case json.Number("0"),json.Number("8"),json.Number("131072"),json.Number("131080"),json.Number("4294967295"): default: return nil, errors.New("unexpected or broad personality value") }
 }
 return rules, nil
}
// Export only schema-validated technical seccomp fields, never the OCI container.
func safeProfile(profile map[string]any) error {
 if _,err:=validateProfile(profile);err!=nil{return err}
 enum:=func(v any, allowed string)bool{ text,ok:=v.(string);return ok&&strings.Contains("|"+allowed+"|","|"+text+"|") }
 number:=func(v any,max uint64)bool{ n,ok:=v.(json.Number);if !ok{return false};x,e:=strconv.ParseUint(string(n),10,64);return e==nil&&x<=max }
 archs,ok:=profile["architectures"].([]any);if !ok||len(archs)==0||len(archs)>32{return errors.New("invalid seccomp architectures")}
 for _,a:=range archs{if !enum(a,"SCMP_ARCH_NATIVE|SCMP_ARCH_X86|SCMP_ARCH_X86_64|SCMP_ARCH_X32|SCMP_ARCH_ARM|SCMP_ARCH_AARCH64|SCMP_ARCH_MIPS|SCMP_ARCH_MIPS64|SCMP_ARCH_MIPS64N32|SCMP_ARCH_MIPSEL|SCMP_ARCH_MIPSEL64|SCMP_ARCH_MIPSEL64N32|SCMP_ARCH_PPC|SCMP_ARCH_PPC64|SCMP_ARCH_PPC64LE|SCMP_ARCH_S390|SCMP_ARCH_S390X|SCMP_ARCH_PARISC|SCMP_ARCH_PARISC64|SCMP_ARCH_RISCV64|SCMP_ARCH_LOONGARCH64"){return errors.New("unsupported architecture")}}
 if raw,exists:=profile["flags"];exists{flags,ok:=raw.([]any);if !ok||len(flags)>8{return errors.New("invalid flags")};for _,f:=range flags{if !enum(f,"SECCOMP_FILTER_FLAG_TSYNC|SECCOMP_FILTER_FLAG_LOG|SECCOMP_FILTER_FLAG_SPEC_ALLOW|SECCOMP_FILTER_FLAG_NEW_LISTENER|SECCOMP_FILTER_FLAG_TSYNC_ESRCH|SECCOMP_FILTER_FLAG_WAIT_KILLABLE_RECV"){return errors.New("unsupported flag")}}}
 rules:=profile["syscalls"].([]any);if len(rules)>4096{return errors.New("too many rules")}
 allowedNames:=map[string]bool{};for _,n:=range strings.Fields(syscallNames){allowedNames[n]=true}
 for _,raw:=range rules{
  rule,_:=object(raw);if !enum(rule["action"],"SCMP_ACT_KILL|SCMP_ACT_KILL_PROCESS|SCMP_ACT_KILL_THREAD|SCMP_ACT_TRAP|SCMP_ACT_ERRNO|SCMP_ACT_TRACE|SCMP_ACT_ALLOW|SCMP_ACT_LOG|SCMP_ACT_NOTIFY"){return errors.New("unsupported rule action")}
  names:=rule["names"].([]any);if len(names)>1024{return errors.New("too many names")};for _,n:=range names{if !allowedNames[n.(string)]{return errors.New("invalid syscall name")}}
  if e,exists:=rule["errnoRet"];exists&&!number(e,4095){return errors.New("invalid errno")}
  if rawArgs,exists:=rule["args"];exists{args,ok:=rawArgs.([]any);if !ok||len(args)>6{return errors.New("invalid arguments")};for _,rawArg:=range args{
   arg,ok:=object(rawArg);if !ok{return errors.New("invalid argument")};for key:=range arg{if key!="index"&&key!="value"&&key!="valueTwo"&&key!="op"{return errors.New("unknown argument field")}}
   if !number(arg["index"],5)||!number(arg["value"],^uint64(0))||!enum(arg["op"],"SCMP_CMP_NE|SCMP_CMP_LT|SCMP_CMP_LE|SCMP_CMP_EQ|SCMP_CMP_GE|SCMP_CMP_GT|SCMP_CMP_MASKED_EQ"){return errors.New("invalid argument fields")}
   if v,exists:=arg["valueTwo"];exists&&!number(v,^uint64(0)){return errors.New("invalid second value")}
  }}
 }
 return nil
}
func mutate(data []byte, bundle string, recipes, profiles map[string]bool) ([]byte, Receipt, bool, error) {
 receipt := Receipt{Status:"rejected"}
 config, err := decode(data); if err != nil { return nil, receipt, false, err }
 if !exactSelection(config) { return data, Receipt{Status:"unmodified"}, false, nil }
 receipt.OriginalConfigSHA256 = digest(data)
 root, ok := object(config["root"]); if !ok { return nil, receipt, true, errors.New("missing bundle root") }
 path, ok := root["path"].(string); if !ok || path == "" { return nil, receipt, true, errors.New("invalid bundle root") }
 if !filepath.IsAbs(path) { path = filepath.Join(bundle, path) }
 receipt.RecipeManifestSHA256, err = verifyRecipe(path, recipes); if err != nil { return nil, receipt, true, err }
 linux, ok := object(config["linux"]); if !ok { return nil, receipt, true, errors.New("missing OCI Linux settings") }
 profile, ok := object(linux["seccomp"]); if !ok { return nil, receipt, true, errors.New("missing OCI seccomp profile") }
 before := canonical(profile); receipt.OriginalProfileSHA256 = digest(before)
 rules, err := validateProfile(profile); if err != nil { return nil, receipt, true, err }
 receipt.OriginalRuleCount = len(rules)
 if err:=safeProfile(profile);err!=nil{return nil,receipt,true,err}
 receipt.OriginalSeccompProfile,_=decode(before)
 if !profiles[receipt.OriginalProfileSHA256] { return nil, receipt, true, errors.New("generated OCI seccomp profile not approved") }
 // Deep clone and prove only one appended syscall rule changed structurally.
 original, _ := decode(canonical(config))
 profile["syscalls"] = append(rules, exactRule)
 result := canonical(config)
 check, err := decode(result); if err != nil { return nil, receipt, true, err }
 checkLinux, _ := object(check["linux"]); checkProfile, _ := object(checkLinux["seccomp"])
 checkRules := checkProfile["syscalls"].([]any)
 if len(checkRules) != len(rules)+1 || !reflect.DeepEqual(checkRules[len(rules)], exactRule) { return nil, receipt, true, errors.New("unexpected appended rule") }
 checkProfile["syscalls"] = checkRules[:len(rules)]
 if !reflect.DeepEqual(check, original) { return nil, receipt, true, errors.New("unexpected OCI structural change") }
 receipt.Status = "approved-delta"
 receipt.ResultConfigSHA256 = digest(result); receipt.ResultProfileSHA256 = digest(canonical(profile))
 receipt.ResultRuleCount = len(rules)+1; receipt.AddedRule = exactRule
 receipt.ChangedPointer = fmt.Sprintf("/linux/seccomp/syscalls/%d", len(rules))
 return result, receipt, true, nil
}
func bundleArgument(args []string) (string, bool) {
 command := false; bundle := ""
 for index, arg := range args {
  if arg == "run" || arg == "create" { command = true }
  if arg == "--bundle" || arg == "-b" { if index+1 >= len(args) || bundle != "" { return "", false }; bundle = args[index+1] }
  if strings.HasPrefix(arg,"--bundle=") { if bundle != "" { return "",false }; bundle = strings.TrimPrefix(arg,"--bundle=") }
 }
 return bundle, command && bundle != ""
}
func main() {
 args := os.Args[1:]
 bundle, inspect := bundleArgument(args)
 if inspect {
  data, err := readLimited(filepath.Join(bundle,"config.json"),configLimit); if err != nil { fmt.Fprintln(os.Stderr,"util delegate: unavailable OCI configuration"); os.Exit(125) }
  result, receipt, selected, err := mutate(data,bundle,approvedRecipes,approvedProfiles)
  if selected { encoded, _ := json.Marshal(receipt); fmt.Fprintln(os.Stderr,string(encoded)) }
  if err != nil { fmt.Fprintln(os.Stderr,"util delegate: selected bundle rejected"); os.Exit(125) }
  if selected {
   // Same-path atomic replacement; bundle is controlled by the ephemeral worker.
   path := filepath.Join(bundle,"config.json"); info, err := os.Stat(path); if err != nil { os.Exit(125) }
   temp, err := os.CreateTemp(bundle,".util-seccomp-"); if err != nil { os.Exit(125) }; name := temp.Name()
   if err = temp.Chmod(info.Mode().Perm()); err == nil { _, err = temp.Write(result) }; if err == nil { err = temp.Sync() }; closeErr := temp.Close()
   if err != nil || closeErr != nil { os.Remove(name); os.Exit(125) }
   if err = os.Rename(name,path); err != nil { os.Remove(name); os.Exit(125) }
  }
 }
 // No argument/environment rewriting. Non-util calls reach real runc unchanged.
 if err := syscall.Exec(realRuntime,append([]string{realRuntime},args...),os.Environ()); err != nil { fmt.Fprintln(os.Stderr,"util delegate: runtime exec failed"); os.Exit(125) }
}
