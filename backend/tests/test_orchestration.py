"""
Orchestrator Core Tests

Minimal test suite for orchestration system.

Run with: uv run python -m pytest backend/tests/
"""

import pytest
from fastapi.testclient import TestClient
from tasks import Orchestrator, AgentCall
from tasks.orchestrator import Task
from main import app


# ============================================================================
# Basic Orchestration Tests
# ============================================================================

@pytest.mark.asyncio
async def test_parallel_execution():
    """Test parallel execution of multiple tools."""
    orchestrator = Orchestrator()

    tool_calls = [
        AgentCall(agent="SimpleTool", args={"value": "A"}),
        AgentCall(agent="SimpleTool", args={"value": "B"}),
        AgentCall(agent="SimpleTool", args={"value": "C"}),
    ]

    await orchestrator.run(tool_calls)

    # Verify all tasks executed
    assert len(orchestrator.compressed.tasks) == 3
    results = sorted([task.result for task in orchestrator.compressed.tasks.values()])
    assert results == ["Tool result: A", "Tool result: B", "Tool result: C"]


def test_task_serialization():
    """Test Task model serialization with Pydantic aliases."""
    from datetime import datetime, timezone

    task = Task(
        parent_unique_id=None,
        run_id="test123",
        agent="SimpleTool",
        args={"value": "test"},
        unique_id="unique123",
        created_at=datetime.now(timezone.utc).isoformat()
    )

    task_dict = task.model_dump(by_alias=True)

    # Verify aliases are used in serialization
    assert task_dict["_type"] == "task"
    assert task_dict["_parent_unique_id"] is None
    assert task_dict["_run_id"] == "test123"
    assert task_dict["agent"] == "SimpleTool"
    assert task_dict["unique_id"] == "unique123"


@pytest.mark.asyncio
async def test_full_conversation_flow_via_api():
    """Test complete conversation flow via /api/chat endpoint with completed_tool_calls."""
    client = TestClient(app)

    # Step 1: User sends message, agent dispatches 2 UserInputTools
    response_1 = client.post("/api/chat", json={
        "log": [],
        "user_message": "Testing",
        "completed_tool_calls": [],
        "agent": "MultiToolAgent",
        "agent_args": {"goal": "Testing"}
    })

    assert response_1.status_code == 200
    data_1 = response_1.json()

    # Verify: 2 pending tool calls, 3 Task entries in logDiff (1 parent + 2 children)
    assert len(data_1["pending_tool_calls"]) == 2
    assert len([e for e in data_1["logDiff"] if e["_type"] == "task"]) == 3
    # completed_tool_calls should be empty (no tools completed yet)
    assert len(data_1["completed_tool_calls"]) == 0

    # Accumulate log
    accumulated_log = data_1["logDiff"]
    pending_1 = data_1["pending_tool_calls"]

    # Step 2: User provides completed tool calls with one wrong tool_call_id
    wrong_tool_call = {"role": "tool", "tool_call_id": "wrong_id", "content": "Wrong response"}
    correct_tool_call_1 = {"role": "tool", "tool_call_id": pending_1[0]["id"], "content": "Response 1"}

    response_2 = client.post("/api/chat", json={
        "log": accumulated_log,
        "user_message": None,
        "completed_tool_calls": [wrong_tool_call, correct_tool_call_1],
        "agent": "MultiToolAgent",
        "agent_args": {}
    })

    assert response_2.status_code == 200
    data_2 = response_2.json()

    # Verify: 1 remaining pending, 1 TaskResult added (for the correct one)
    assert len(data_2["pending_tool_calls"]) == 1
    assert data_2["pending_tool_calls"][0]["id"] == pending_1[1]["id"]  # Second tool still pending
    assert len([e for e in data_2["logDiff"] if e["_type"] == "task_result"]) == 1
    # completed_tool_calls should have 1 entry (the one that was completed)
    assert len(data_2["completed_tool_calls"]) == 1
    assert data_2["completed_tool_calls"][0]["tool_call_id"] == pending_1[0]["id"]
    assert data_2["completed_tool_calls"][0]["content"] == "Response 1"
    assert "run_id" in data_2["completed_tool_calls"][0]
    assert "function" in data_2["completed_tool_calls"][0]

    accumulated_log.extend(data_2["logDiff"])
    pending_2 = data_2["pending_tool_calls"]

    # Step 3: User provides empty completed tool calls
    response_3 = client.post("/api/chat", json={
        "log": accumulated_log,
        "user_message": None,
        "completed_tool_calls": [],
        "agent": "MultiToolAgent",
        "agent_args": {}
    })

    assert response_3.status_code == 200
    data_3 = response_3.json()

    # Verify: Same 1 pending, empty logDiff (no change)
    assert len(data_3["pending_tool_calls"]) == 1
    assert data_3["pending_tool_calls"][0]["id"] == pending_2[0]["id"]
    assert len(data_3["logDiff"]) == 0
    assert len(data_3["completed_tool_calls"]) == 0

    accumulated_log.extend(data_3["logDiff"])
    pending_3 = data_3["pending_tool_calls"]

    # Step 4: User provides correct completed tool call for remaining task
    correct_tool_call_2 = {"role": "tool", "tool_call_id": pending_3[0]["id"], "content": "Response 2"}

    response_4 = client.post("/api/chat", json={
        "log": accumulated_log,
        "user_message": None,
        "completed_tool_calls": [correct_tool_call_2],
        "agent": "MultiToolAgent",
        "agent_args": {}
    })

    assert response_4.status_code == 200
    data_4 = response_4.json()

    # Verify: 0 pending (all complete), parent completed
    assert len(data_4["pending_tool_calls"]) == 0
    # Should have the second tool completion + parent completion
    assert len(data_4["completed_tool_calls"]) == 2
    # Find the child tool completion
    child_completion = next(c for c in data_4["completed_tool_calls"]
                           if c["tool_call_id"] == pending_3[0]["id"])
    assert child_completion["content"] == "Response 2"
    assert "run_id" in child_completion
    assert "function" in child_completion
    # Find parent completion
    parent_completion = next(c for c in data_4["completed_tool_calls"]
                            if c["tool_call_id"] != pending_3[0]["id"])
    assert parent_completion["content"] == "All tools completed"

    accumulated_log.extend(data_4["logDiff"])

    # Find the root task from logDiff to get its unique_id for step 6
    root_tasks = [e for e in accumulated_log if e["_type"] == "task" and e["_parent_unique_id"] is None]
    assert len(root_tasks) == 1
    root_task_id = root_tasks[0]["unique_id"]

    # Step 5: New conversation turn with previous_unique_id linking
    # This simulates starting a new conversation that references the previous one
    response_5 = client.post("/api/chat", json={
        "log": accumulated_log,
        "user_message": "Continue conversation",
        "completed_tool_calls": [],
        "agent": "MultiToolAgent",
        "agent_args": {}
    })

    assert response_5.status_code == 200
    data_5 = response_5.json()

    # Verify: New task was created and accessed previous conversation history
    new_root_tasks = [e for e in data_5["logDiff"] if e["_type"] == "task" and e["_parent_unique_id"] is None]
    assert len(new_root_tasks) == 1
    new_task = new_root_tasks[0]
    assert new_task["_previous_unique_id"] == root_task_id

    # Verify: Should have completed immediately with result showing it accessed history
    assert len(data_5["completed_tool_calls"]) == 1
    assert data_5["completed_tool_calls"][0]["tool_call_id"] == new_task["unique_id"]
    # The result should be '5' (length of previous thread)
    assert data_5["completed_tool_calls"][0]["content"] == '5'


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
