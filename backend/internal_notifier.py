"""
Bug channel notifier for app-level bug reporting.
Completely independent of company config — uses INTERNAL_SLACK_CHANNEL_WEBHOOK env var directly.
Never re-uses any company-configured webhook.
"""
import json
import os
import logging
import subprocess
from datetime import datetime, timezone
import httpx

logger = logging.getLogger(__name__)


def _read_git_commit_sha() -> str:
    try:
        return subprocess.check_output(['git', 'rev-parse', 'HEAD'], stderr=subprocess.DEVNULL).decode().strip()[:8]
    except Exception:
        return 'unknown'


_GIT_COMMIT_SHA = _read_git_commit_sha()


async def notify_internal(source: str, message: str, extras: dict | None = None) -> None:
    webhook_url = os.environ.get('INTERNAL_SLACK_CHANNEL_WEBHOOK')
    if not webhook_url:
        return

    err_obj = {'source': source, 'message': message, 'commit': _GIT_COMMIT_SHA, **(extras or {})}
    payload = {
        'email_id': (extras or {}).get('user', source),
        'created_at': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
        'err_str': json.dumps(err_obj),
        'thread_url': os.environ.get('AUTH_URL', 'https://minusx.ai'),
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(webhook_url, json=payload)
    except Exception as e:
        logger.error(f'[internal-notifier] Failed to send internal notification: {e}')
