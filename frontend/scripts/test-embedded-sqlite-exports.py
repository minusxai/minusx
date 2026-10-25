from pathlib import Path
import runpy
import unittest

verify = runpy.run_path(str(Path(__file__).with_name('check-embedded-sqlite-exports.py')))['verify_defined_symbols']


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


if __name__ == '__main__':
    unittest.main()
