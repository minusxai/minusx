// Record configuration applicability without disclosing configuration contents.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.argv[2] || '/';
const records = [];
const visited = new Set();
function inspect(relative) {
  const target = path.join(root, relative);
  if (!fs.existsSync(target)) return;
  const real = fs.realpathSync(target);
  if (visited.has(real)) return;
  visited.add(real);
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target).sort()) inspect(path.join(relative, name));
  } else if (stat.isFile()) {
    const bytes = fs.readFileSync(target);
    const active = bytes.toString('utf8').replace(/\\\r?\n/g, '').split(/\r?\n/)
      .filter(line => line.trim() && !line.trim().startsWith('#'));
    const count = active.filter(line => /(?:^|\s)(?:\S*\/)?pam_userdb\.so(?:\s|$)/.test(line)).length;
    records.push({relative, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), count});
  }
}
for (const location of ['etc/pam.conf', 'etc/pam.d', 'usr/lib/pam.conf', 'usr/lib/pam.d']) inspect(location);
const digest = crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex');
console.log(JSON.stringify({
  schema: 1, configuration_files: records.length,
  active_pam_userdb_references: records.reduce((sum, record) => sum + record.count, 0),
  configuration_set_sha256: digest,
  limitation: 'Captures image PAM configuration only. Does not prove arbitrary callers or runtime configuration changes safe, and does not claim the installed module source is fixed.'
}, null, 2));
