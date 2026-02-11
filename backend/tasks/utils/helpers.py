"""Utility helper functions for task orchestration."""

import base64
import hashlib


def short_hash(s: str, max_len: int = 16) -> str:
    """
    Generate a short hash of a string using SHA-256.

    Args:
        s: String to hash
        max_len: Maximum length of the output hash (default: 16)

    Returns:
        URL-safe base64-encoded hash of specified length
    """
    h = hashlib.sha256(s.encode()).digest()[:max_len]
    return base64.urlsafe_b64encode(h).decode()[:max_len]
