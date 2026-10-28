"""Apply only the separately reviewed package implementation override."""
import hashlib,json,shutil,sys
from pathlib import Path
recipe,replacement,proof_path=map(Path,sys.argv[1:]);proof=json.loads(proof_path.read_text())
old=proof['recipe']['package.py']['sha256'];new=hashlib.sha256(replacement.read_bytes()).hexdigest()
assert new=='9a8525e663fc9e998141a00121c8d3fec1235f99f1905b767b0765d0d0198317'
assert hashlib.sha256((recipe/'package.py').read_bytes()).hexdigest()==old
manifest=(recipe/'SHA256SUMS').read_text();assert manifest==proof['recipe_manifest'] and manifest.count(old+'  package.py\n')==1
shutil.copyfile(replacement,recipe/'package.py');(recipe/'SHA256SUMS').write_text(manifest.replace(old+'  package.py\n',new+'  package.py\n'))
