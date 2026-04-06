"""
Bug channel notifier for app-level bug reporting.
Routes through MX_API_BASE_URL/notify → SLACK_ERRORS_WEBHOOK.
Never re-uses any company-configured webhook.
"""
import os
import logging
import subprocess
from datetime import datetime, timezone
import httpx

logger = logging.getLogger(__name__)

_MX_API_BASE_URL = os.environ.get('MX_API_BASE_URL', '')
_MX_API_KEY = os.environ.get('MX_API_KEY', '')


def _read_git_commit_sha() -> str:
    try:
        return subprocess.check_output(['git', 'rev-parse', 'HEAD'], stderr=subprocess.DEVNULL).decode().strip()[:8]
    except Exception:
        return 'unknown'


_GIT_COMMIT_SHA = _read_git_commit_sha()


async def notify_internal(source: str, message: str, extras: dict | None = None) -> None:
    if not _MX_API_BASE_URL:
        return

    payload = {
        'type': 'error',
        'source': source,
        'message': message,
        'commit': _GIT_COMMIT_SHA,
        'created_at': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
        **(extras or {}),
    }
    headers = {'Content-Type': 'application/json'}
    if _MX_API_KEY:
        headers['mx-api-key'] = _MX_API_KEY

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(f'{_MX_API_BASE_URL}/notify', json=payload, headers=headers)
    except Exception as e:
        logger.error(f'[internal-notifier] Failed to send internal notification: {e}')
