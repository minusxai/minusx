"""Lean utilities for converting between tasks and LLM message formats."""

import json
from typing import List, Dict, Any
from .orchestrator import CompressedTask, AgentCall, Orchestrator
from .types import ChatCompletionMessageToolCallParamMX


def parse_json(json_str: str) -> Any:
    """Parse JSON string, return string if parsing fails."""
    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        return json_str


def tool_calls_to_agent_calls(
    tool_calls: List[ChatCompletionMessageToolCallParamMX],
    content: str = "",
    citations: List[Any] = [],
    content_blocks: List[Dict[str, Any]] | None = None
) -> List[AgentCall]:
    """Convert LLM tool calls to AgentCalls, handling content as TalkToUser."""
    agent_calls = []

    # Convert content to TalkToUser if present
    # Prefer content_blocks if available, fall back to content string
    if content_blocks:
        agent_calls.append(AgentCall(
            agent="TalkToUser",
            args={"content_blocks": content_blocks},
        ))
    elif content:
        # Backward compatibility: wrap string in text block
        agent_calls.append(AgentCall(
            agent="TalkToUser",
            args={"content_blocks": [{"type": "text", "text": content}], "citations": citations},
        ))

    for tool_call in tool_calls:
        args = parse_json(tool_call["function"]["arguments"])

        if isinstance(args, str):
            agent_calls.append(AgentCall(
                agent=tool_call["function"]["name"],
                args={"_original_args": args},
                unique_id=tool_call["id"],
                error="Invalid JSON in arguments"
            ))
        else:
            agent_calls.append(AgentCall(
                agent=tool_call["function"]["name"],
                args=args,
                unique_id=tool_call["id"]
            ))

    return agent_calls


def tasks_to_assistant_message(tasks: List[CompressedTask]) -> Dict[str, Any]:
    """Convert batch of tasks to LLM assistant message, TalkToUser becomes content."""
    # Separate TalkToUser tasks from regular tasks
    talk_to_user_tasks = [t for t in tasks if t.agent == "TalkToUser" and t.result is not None]
    regular_tasks = [t for t in tasks if t.agent != "TalkToUser"]

    # Extract content blocks from TalkToUser results
    content_blocks = []
    for task in talk_to_user_tasks:
        parsed = parse_json(str(task.result))
        if isinstance(parsed, dict) and "content_blocks" in parsed:
            # Extract content blocks array
            content_blocks.extend(parsed["content_blocks"])
        elif isinstance(parsed, dict) and "content" in parsed:
            # Legacy: wrap string in text block
            content_blocks.append({"type": "text", "text": parsed["content"]})
        else:
            # Fallback: wrap raw result as text
            content_blocks.append({"type": "text", "text": str(task.result)})

    # Build tool_calls for regular tasks
    tool_calls = []
    for task in regular_tasks:
        cleaned_args = {k: v for k, v in task.args.items() if not k.startswith('_')}
        tool_calls.append({
            "id": task.unique_id,
            "type": "function",
            "function": {
                "name": task.agent,
                "arguments": json.dumps(cleaned_args)
            }
        })

    message = {"role": "assistant"}
    if content_blocks:
        message["content"] = content_blocks  # Use content blocks array
    if tool_calls:
        message["tool_calls"] = tool_calls

    return message


def task_to_tool_message(task: CompressedTask) -> Dict[str, Any]:
    """Convert completed task to tool response message."""
    if task.result is None:
        raise ValueError(f"Task {task.unique_id} has no result")

    return {
        "role": "tool",
        "tool_call_id": task.unique_id,
        "content": task.result
    }

def task_batch_to_thread(task_batch: List[List[CompressedTask]]):
    thread = []
    for batch in task_batch:
        if not batch:
            continue

        # Split into completed and pending
        completed_tasks = [t for t in batch if t.result is not None]
        pending_tasks = [t for t in batch if t.result is None]

        # Add assistant message with tool calls (TalkToUser becomes content)
        all_tasks = completed_tasks + pending_tasks
        all_tasks = [t for t in all_tasks if t.agent != 'web_search']
        if all_tasks:
            thread.append(tasks_to_assistant_message(all_tasks))

        # Add tool responses for completed non-TalkToUser tasks
        for task in completed_tasks:
            if task.agent not in ["TalkToUser", "web_search"]:
                thread.append(task_to_tool_message(task))

        # Stop at first pending batch
        if pending_tasks:
            break
    return thread

def root_tasks_to_thread(root_tasks: List[CompressedTask], orchestrator: Orchestrator) -> List[Dict[str, Any]]:
    """Convert root task history to LLM thread format."""
    thread = []

    for root_task in root_tasks:
        # Add user message from root task args
        user_message = root_task.args.get("goal", "")
        thread.append({
            "role": "user",
            "content": user_message
        })

        # Get child tasks grouped by run_id
        child_batches = orchestrator.get_children(root_task.unique_id)
        thread.extend(task_batch_to_thread(child_batches))

        # Add final root task result if available
        if root_task.result is not None:
            content = root_task.result
            if isinstance(content, dict):
                content = content.get('content')
            if content:
                thread.append({
                    "role": "assistant",
                    "content": content
                })

    return thread
