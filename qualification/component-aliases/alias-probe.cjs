'use strict';
const fs=require('node:fs'),path=require('node:path');
/** All traversal is read-only. Identity binding belongs to authenticated executor. */
function inspectAliases(root='/',io=fs){
 const out={schema:1,probe_uid:process.getuid?.()??-1,image_identity_bound:false,virtual_roots_excluded:true,virtual_target_count:0,escaping_target_count:0,error_count:0,bound_hit:false,directory_count:0,entry_count:0,symlink_count:0,file_symlink_count:0,directory_symlink_count:0,dangling_symlink_count:0,other_symlink_count:0,directory_alias_already_visited_count:0,directory_alias_new_target_count:0,homed_matching_entry_count:0,ordinary_rootfs_alias_closure_complete:false,component_absence_proven:false};
 let base;try{base=io.realpathSync(root);}catch{out.error_count++;return out;}
 const deadline=Date.now()+30000,visited=new Set(),queued=new Set([base]),todo=[base],aliases=[];
 const contained=p=>p===base||p.startsWith(base==='/'?'/':base+path.sep);
 const virtual=p=>['proc','sys','dev'].some(n=>p===path.join(base,n)||p.startsWith(path.join(base,n)+path.sep));
 const names=new Set(['systemd-homed','homectl','systemd-homed.service','org.freedesktop.home1.service']);
 const bounded=()=>{if(Date.now()>deadline||out.entry_count>=500000||out.directory_count>=100000){out.bound_hit=true;return true;}return false;};
 // Pass one walks ordinary directories only; pass two closes every discovered alias.
 const drain=()=>{while(todo.length&&!bounded()){
  const dir=todo.shift();if(visited.has(dir))continue;visited.add(dir);out.directory_count++;
  let entries;try{entries=io.readdirSync(dir,{withFileTypes:true});}catch{out.error_count++;continue;}
  for(const e of entries){if(bounded())break;out.entry_count++;const p=path.join(dir,e.name);if(virtual(p))continue;if(names.has(e.name))out.homed_matching_entry_count++;
   if(e.isSymbolicLink()){out.symlink_count++;aliases.push(p);}else if(e.isDirectory()&&!queued.has(p)){queued.add(p);todo.push(p);}
  }
 }};
 drain();let index=0;
 while(index<aliases.length&&!bounded()){
  const p=aliases[index++];let target,st;
  try{target=io.realpathSync(p);if(!contained(target)){out.escaping_target_count++;continue;}if(virtual(target)){out.virtual_target_count++;continue;}st=io.statSync(target);}
  catch(e){if(e.code==='ENOENT'||e.code==='ENOTDIR')out.dangling_symlink_count++;else out.error_count++;continue;}
  if(st.isDirectory()){out.directory_symlink_count++;if(visited.has(target))out.directory_alias_already_visited_count++;else{out.directory_alias_new_target_count++;if(!queued.has(target)){queued.add(target);todo.push(target);}drain();}}
  else if(st.isFile())out.file_symlink_count++;else out.other_symlink_count++;
 }
 out.ordinary_rootfs_alias_closure_complete=out.error_count===0&&!out.bound_hit&&out.escaping_target_count===0&&index===aliases.length&&todo.length===0;
 // Only component names in this fixed immutable rootfs scope are claimed absent.
 out.component_absence_proven=out.ordinary_rootfs_alias_closure_complete&&out.homed_matching_entry_count===0;
 return out;
}
module.exports={inspectAliases};
