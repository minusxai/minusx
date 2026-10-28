from pathlib import Path
import runpy
import unittest
import subprocess
import sys
import tempfile

checks = runpy.run_path(str(Path(__file__).with_name('check-embedded-sqlite-exports.py')))
verify = checks['verify_defined_symbols']
defined_symbols = checks['defined_symbols']


class DefinedImplementation(unittest.TestCase):
    def test_visible_ordinary_sqlite_without_session(self):
        verify({'sqlite3_libversion', 'sqlite3_open', 'sqlite3_close'})

    def test_empty_or_hidden_sqlite_is_not_absence_evidence(self):
        with self.assertRaises(AssertionError):
            verify(set())

    def test_each_session_implementation_family_fails(self):
        for name in ['sqlite3session_create', 'sqlite3changeset_concat', 'sqlite3_preupdate_hook']:
            with self.subTest(symbol=name), self.assertRaises(AssertionError):
                verify({'sqlite3_libversion', name})


@unittest.skipUnless(sys.platform.startswith('linux'), 'ELF toolchain fixtures run on Linux')
class ActualELFSymbolTables(unittest.TestCase):
    def test_local_definition_undefined_stripped_and_forbidden_local(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def build(name, source):
                code = root / (name + '.c')
                module = root / (name + '.so')
                code.write_text(source)
                subprocess.run(['cc', '-shared', '-fPIC', '-O0', str(code), '-o', str(module)], check=True)
                return module
            ordinary = '__attribute__((visibility("hidden"))) const char *sqlite3_libversion(void) { return "fixture"; }\n'
            good = build('localized', ordinary)
            dynamic = subprocess.check_output(['nm', '--dynamic', '--defined-only', str(good)], text=True)
            self.assertNotIn('sqlite3_libversion', dynamic)
            verify(defined_symbols(good))
            undefined = build('undefined', 'extern const char *sqlite3_libversion(void); const char *entry(void) { return sqlite3_libversion(); }')
            with self.assertRaises(AssertionError):
                verify(defined_symbols(undefined))
            stripped = root / 'stripped.so'
            stripped.write_bytes(good.read_bytes())
            subprocess.run(['strip', '--strip-all', str(stripped)], check=True)
            with self.assertRaises(AssertionError):
                verify(defined_symbols(stripped))
            for symbol in ['sqlite3session_create', 'sqlite3changeset_concat', 'sqlite3_preupdate_hook']:
                forbidden = build(symbol, ordinary + '__attribute__((visibility("hidden"))) void ' + symbol + '(void) {}')
                with self.assertRaises(AssertionError):
                    verify(defined_symbols(forbidden))


if __name__ == '__main__':
    unittest.main()
