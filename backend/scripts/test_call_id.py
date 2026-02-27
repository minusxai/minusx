#!/usr/bin/env python3
"""Test that lllm_call_id in task_debug matches call_uuid in mx.db.

Verifies the full chain:
  allm_request() → client generates UUID → sent as X-MX-Request-Call-ID header
  → MxProxyTransport forwards header to mx-llm-provider
  → provider uses this UUID as call_uuid (stored in mx.db)
  → same UUID stored as lllm_call_id in task_debug → both match

Requires:
  - mx-llm-provider running (MX_API_BASE_URL set in backend/.env)
  - mx.db accessible (MX_DB_PATH env var or default path)

Run from backend/:
  uv run python scripts/test_call_id.py
"""

import asyncio
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from tasks.llm.client import allm_request
from tasks.llm.models import ALLMRequest, LlmSettings
from tasks.llm.config import MX_API_BASE_URL
from tasks.debug_context import set_task_debug, TaskDebug

MX_DB_PATH = os.environ.get(
    "MX_DB_PATH",
    os.path.join(os.path.dirname(__file__), "../../../mx-llm-provider/data/mx.db"),
)


async def main() -> None:
    if not MX_API_BASE_URL:
        sys.exit("ERROR: MX_API_BASE_URL is not set — mx-llm-provider not configured")

    print(f"Provider : {MX_API_BASE_URL}")
    print(f"DB path  : {os.path.abspath(MX_DB_PATH)}\n")

    task_debug = TaskDebug()
    with set_task_debug(task_debug):
        print("Calling allm_request with a minimal prompt...")
        request = ALLMRequest(
            messages=[{"role": "user", "content": "Reply with exactly one word: pong"}],
            llmSettings=LlmSettings(
                model="claude-sonnet-4-6",
                response_format={"type": "text"},
                tool_choice=None,
            ),
            tools=[],
        )
        response, _usage = await allm_request(request)

    debug_call_id = task_debug.llmDebug[0].lllm_call_id if task_debug.llmDebug else None

    print(f"Response     : {response['content'][:80]!r}")
    print(f"lllm_call_id : {debug_call_id}")

    if not debug_call_id:
        print("\nFAIL: lllm_call_id not set in task_debug")
        sys.exit(1)

    # Provider writes to mx.db via asyncio.create_task — give it a moment
    print("\nWaiting 1s for provider to flush to mx.db...")
    await asyncio.sleep(1)

    db_path = os.path.abspath(MX_DB_PATH)
    if not os.path.exists(db_path):
        print(f"SKIP: mx.db not found at {db_path}")
        return

    con = sqlite3.connect(db_path)
    row = con.execute(
        "SELECT call_uuid, model, total_tokens, cost_usd FROM stats WHERE call_uuid = ?",
        (debug_call_id,),
    ).fetchone()
    con.close()

    if row:
        print(f"\nmx.db row found:")
        print(f"  call_uuid    : {row[0]}")
        print(f"  model        : {row[1]}")
        print(f"  total_tokens : {row[2]}")
        print(f"  cost_usd     : ${row[3]:.6f}")
        assert row[2] > 0, f"total_tokens should be > 0, got {row[2]}"
        print(f"\nPASS: lllm_call_id matches call_uuid in mx.db, total_tokens={row[2]}")
    else:
        print(f"\nFAIL: call_uuid {debug_call_id!r} not found in mx.db")
        con = sqlite3.connect(db_path)
        recent = con.execute(
            "SELECT call_uuid, created_at FROM stats ORDER BY created_at DESC LIMIT 3"
        ).fetchall()
        con.close()
        print("Recent rows in mx.db:")
        for r in recent:
            print(f"  {r[0]}  {r[1]}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
