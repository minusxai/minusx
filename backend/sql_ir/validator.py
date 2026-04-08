"""Validation logic for SQL IR — UnsupportedSQLError only."""

from typing import List


class UnsupportedSQLError(Exception):
    """Raised when SQL contains features not supported by GUI builder."""
    def __init__(self, message: str, features: List[str], hint: str = None):
        super().__init__(message)
        self.features = features
        self.hint = hint
