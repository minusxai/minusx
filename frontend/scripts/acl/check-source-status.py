#!/usr/bin/env python3
"""Exercise actual status parser and subprocess assignment without fetching source."""
import ast
import os
import pathlib
import re
import subprocess
import tempfile

tree = ast.parse(pathlib.Path(__file__).with_name('build-acl.py').read_text())
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'valid_signers'
         or isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'authentication' for t in n.targets)]
assert len(nodes) == 2
with tempfile.TemporaryDirectory(prefix='acl-status-') as directory:
    root = pathlib.Path(directory)
    gpgv = root / 'gpgv'
    gpgv.write_text('#!/usr/bin/env python3\nimport os,sys\nsys.stdout.buffer.write(b"[GNUPG:] GOODSIG unrelated\\x82metadata\\n[GNUPG:] VALIDSIG " + b"A"*40 + b" 2026-10-28\\n")\nsys.exit(int(os.environ.get("ACL_FAKE_STATUS", "0")))\n')
    gpgv.chmod(0o755)
    old_path = os.environ['PATH']
    os.environ['PATH'] = str(root) + os.pathsep + old_path
    namespace = dict(re=re, subprocess=subprocess, root=root, keyring='unused')
    code = compile(ast.Module(body=nodes, type_ignores=[]), 'actual-source-status', 'exec')
    try:
        exec(code, namespace)
        parse = namespace['valid_signers']
        assert parse(namespace['authentication']) == ['A' * 40]
        for bad in (b'', b'[GNUPG:] VALIDSIG nope\n', b'[GNUPG:] VALIDSIG \xff\n'):
            try:
                parse(bad)
            except (AssertionError, UnicodeDecodeError):
                pass
            else:
                raise AssertionError('Malformed or missing signer accepted')
        os.environ['ACL_FAKE_STATUS'] = '1'
        try:
            exec(code, namespace)
        except subprocess.CalledProcessError:
            pass
        else:
            raise AssertionError('Failed verifier accepted')
    finally:
        os.environ['PATH'] = old_path
        os.environ.pop('ACL_FAKE_STATUS', None)
print('PASS: mixed-byte metadata, strict signer grammar, absent signer and verifier failure')
