'use strict';
// Read-only; external authenticated executor owns immutable image identity binding.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const KNOWN = '355b4cbbed880b0381a04c46617b7656e362585d52e9cf84a67e2009b749ff11';

function inspect(root = '/', execute = false, io = fs, launch = cp.spawnSync) {
  root = io.realpathSync(path.resolve(root));
  let errors = 0, homed = 0, tar = 0, visited = 0, skippedAliases = 0;
  const deadline=Date.now()+30000;
  const readBounded = p => {
    const target=io.realpathSync(p);
    if(target!==root && !target.startsWith(root==='/'?'/':root+path.sep)) throw new Error('outside');
    const st=io.statSync(target);
    if(!st.isFile() || st.size>32*1024*1024) throw new Error('bounded regular file required');
    return io.readFileSync(target);
  };
  const receipts = [];
  const hash = p => crypto.createHash('sha256').update(readBounded(p)).digest('hex');
  const walk = (dir,depth=0) => {
    if(depth>128 || Date.now()>deadline || visited>500000) {errors++;return;}
    let entries;
    try { entries = io.readdirSync(dir, {withFileTypes:true}); } catch { errors++; return; }
    for (const e of entries) {
      if(++visited > 500000) {errors++; return;}
      if (dir === root && ['proc','sys','dev'].includes(e.name)) continue;
      const p = path.join(dir,e.name);
      if (['systemd-homed','homectl','systemd-homed.service','org.freedesktop.home1.service'].includes(e.name)) homed++;
      if (e.name === 'Tar.pm' && path.basename(dir) === 'Archive') tar++;
      if (e.name === 'runtime-source.json') {
        try {
          const bytes=readBounded(p);
          const receiptHash=crypto.createHash('sha256').update(bytes).digest('hex');
          const v = JSON.parse(bytes.toString());
          if (v.source === 'ncurses') receipts.push({receipt_sha256:receiptHash,known_source_sha256_matches:v.archive?.sha256 === KNOWN,infocmp_replacement_declared:Array.isArray(v.replaced) && v.replaced.some(x=>x.installed==='/usr/bin/infocmp')});
        } catch { errors++; }
      }
      if(e.isSymbolicLink()) skippedAliases++;
      if (e.isDirectory() && !e.isSymbolicLink()) walk(p,depth+1);
    }
  };
  walk(root);
  const info = {canonical_path_present:false,sha256:null,version:null};
  const binary = path.join(root,'usr/bin/infocmp');
  try {
    io.lstatSync(binary); info.canonical_path_present=true;
    const resolved=io.realpathSync(binary);
    if (resolved !== root && !resolved.startsWith(root === '/' ? '/' : root + path.sep)) errors++;
    else info.sha256=hash(resolved);
  } catch(e) { if (!['ENOENT','ENOTDIR'].includes(e.code)) errors++; }
  let perl={executed:false};
  if (execute) {
    if(root!=='/' && launch===cp.spawnSync) throw new Error('Runtime execution requires root');
    const r=launch('/usr/bin/infocmp',['-V'],{encoding:'utf8',timeout:10000,maxBuffer:4096});
    const v=(r.stdout||'').trim();
    info.version=/^ncurses [0-9][0-9A-Za-z.+ -]{0,80}$/.test(v)?v:null;
    info.version_command_succeeded=r.status===0 && info.version!==null;
    // Locate source via @INC without loading Archive::Tar or invoking search hooks.
    const code=String.raw`for my $d (@INC) { if(ref($d)) { print "H\n"; } else { print "P",unpack("H*",$d),"\n"; } }`;
    const env={...process.env}; delete env.PERL5OPT; delete env.PERL5LIB;
    const p=launch('/usr/bin/perl',['-e',code],{env,encoding:'utf8',timeout:10000,maxBuffer:65536});
    perl={executed:p.status===0,effective_scope_ambient_perl_options_removed:true,search_path_entries:0,relative_search_entry_count:0,invalid_search_entry_count:0,search_capture_complete:p.status===0,uninspected_search_hook_count:0,search_path_candidates:0,read_error_count:0,nonregular_count:0,symlink_count:0,oversize_count:0,candidate_sha256:[],declared_versions:[]};
    const lines=(p.stdout||'').split('\n'); if(lines.at(-1)==='') lines.pop();
    if(p.status===0) for(const line of lines) {
      if(line==='H') {perl.uninspected_search_hook_count++;continue;}
      if(!/^P(?:[0-9a-f]{2})*$/.test(line)) {perl.invalid_search_entry_count++;perl.search_capture_complete=false;continue;}
      perl.search_path_entries++;
      const entry=Buffer.from(line.slice(1),'hex').toString();
      if(!path.isAbsolute(entry)) perl.relative_search_entry_count++;
      const file=path.join(entry,'Archive/Tar.pm');
      try {
        const stat=fs.lstatSync(file); if(stat.isSymbolicLink()) perl.symlink_count++;
        const target=fs.statSync(file); if(!target.isFile()) {perl.nonregular_count++;continue;}
        perl.search_path_candidates++;
        if(target.size>4*1024*1024) {perl.oversize_count++;continue;}
        const bytes=fs.readFileSync(file);perl.candidate_sha256.push(crypto.createHash('sha256').update(bytes).digest('hex'));
        const match=bytes.toString().match(/(?:^|\n)[ \t]*(?:our[ \t]+)?\$VERSION[ \t]*=[ \t]*(['"])([0-9][0-9._]*)\1[ \t]*;/);
        if(match) perl.declared_versions.push(match[2]);
      } catch(e) {if(!['ENOENT','ENOTDIR'].includes(e.code)) perl.read_error_count++;}
    }
  }
  return {schema:1,image_identity_bound:false,traversal:{error_count:errors,traversal_error_free:errors===0,ordinary_rootfs_complete:false,unfollowed_symlink_count:skippedAliases,virtual_mounts_excluded:true,directory_symlinks_followed:false,symlink_target_absence_proven:false},ncurses_infocmp:info,ncurses_source_receipts:receipts,source_to_binary_binding_proven:false,systemd_homed:{matching_entry_count:homed,matching_entries_present:homed>0,component_absence_proven:false},perl_archive_tar:{rootfs_candidate_count:tar,...perl},package_absence_checked:false};
}
module.exports={inspect,KNOWN};
if(require.main===module) process.stdout.write(JSON.stringify(inspect('/',true))+'\n');
