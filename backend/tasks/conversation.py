"""Conversation log utilities for managing task results and extracting tool calls."""
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple, cast
from .orchestrator import ConversationLog, TaskResult, Task
from .types import (
    ChatCompletionToolMessageParamMX,
    ChatCompletionMessageToolCallParamMX,
    CompletedToolCallsMXWithRunId,
    ChatCompletionToolMessageParamMXWithRunId
)


def get_latest_root(log: ConversationLog) -> Tuple[Optional[int], Optional[Task]]:
    """Find the index of the latest root task (parent_unique_id=None) in the log."""
    latest_root = None
    latest_root_index = None
    for i, entry in enumerate(log):
        if entry.type_ == "task" and entry.parent_unique_id is None:
            latest_root_index = i
            latest_root = entry
    return latest_root_index, latest_root

def get_pending_leaf_tasks(log: ConversationLog) -> Iterable[Task]:
    """
    Extract pending tasks from the latest root node onwards.
    A task is pending if it doesn't have a corresponding TaskResult.
    """
    latest_root_index, _ = get_latest_root(log)
    if latest_root_index is None:
        return []

    # Build map of unique_id -> Task from latest root onwards
    pending_leaf_tasks: Dict[str, Task] = {}
    for entry in log[latest_root_index:]:
        if entry.type_ == "task":
            pending_leaf_tasks[entry.unique_id] = entry
        elif entry.type_ == "task_result":
            pending_leaf_tasks.pop(entry.task_unique_id, None)
    for entry in list(pending_leaf_tasks.values()):
        if entry.parent_unique_id in pending_leaf_tasks:
            pending_leaf_tasks.pop(entry.parent_unique_id)
    return pending_leaf_tasks.values()

def pending_leaf_task_to_tool_call(
    task: Task,
    task_map: Optional[Dict[str, Task]] = None,
    result_map: Optional[Dict[str, Any]] = None
) -> ChatCompletionMessageToolCallParamMX:
    """
    Convert a pending leaf task to a ToolCall.

    For pending leaf tasks, if they have children, those children are guaranteed complete.
    If task_map and result_map are provided, attaches child_tasks_batch with results.

    Args:
        task: A pending leaf task (no TaskResult, and if has children they're all complete)
        task_map: Optional map of unique_id -> Task (for finding children)
        result_map: Optional map of unique_id -> result (for getting child results)

    Returns:
        ToolCall with child_tasks_batch attached if the task has children
    """
    tool_call = cast(ChatCompletionMessageToolCallParamMX, {
        "id": task.unique_id,
        "type": "function",
        "function": {
            "name": task.agent,
            "arguments": task.args  # No need for json.dumps - HTTP response handles serialization
        }
    })

    # Attach child results if we have the necessary maps
    if task_map and result_map:
        # Find children (guaranteed complete if they exist, since task is pending leaf)
        children = [t for t in task_map.values()
                   if t.parent_unique_id == task.unique_id]

        if children:
            # Group children by run_id to match orchestrator structure
            children_by_run_id: Dict[str, List[Task]] = defaultdict(list)
            for child in children:
                children_by_run_id[child.run_id].append(child)

            # Create list of lists, grouped by run_id (not persisted to log)
            # Now attached to function field (part of FunctionCallMX)
            tool_call["function"]["child_tasks_batch"] = [
                [
                    {
                        'tool_call_id': child.unique_id,
                        'agent': child.agent,
                        'args': child.args,
                        'result': result_map[child.unique_id]
                    }
                    for child in group
                ]
                for _run_id, group in children_by_run_id.items()
            ]

    return tool_call

def update_log_with_completed_tool_calls(
    log: ConversationLog,
    completed_tool_calls: List[ChatCompletionToolMessageParamMX],
    interrupt_pending = False
) -> tuple[ConversationLog, List[ChatCompletionMessageToolCallParamMX]]:
    """
    Append TaskResult entries for completed tool calls.
    Only considers tasks from the latest root node onwards.

    Returns:
        Tuple of (updated_log, remaining_pending_tool_calls)
        If remaining_pending_tool_calls is non-empty, orchestrator should NOT resume yet.
    """
    pending_leaf_tasks = get_pending_leaf_tasks(log)

    completed_map = {
        tool_call['tool_call_id']: tool_call['content']
        for tool_call in completed_tool_calls
    }

    remaining_pending_tool_calls = []

    # Append TaskResult for completed tasks
    for task in pending_leaf_tasks:
        if task.unique_id in completed_map:
            content = completed_map[task.unique_id]
            log.append(TaskResult(
                task_unique_id=task.unique_id,
                result=content,
                created_at=datetime.now(timezone.utc).isoformat()
            ))
        elif interrupt_pending:
            log.append(TaskResult(
                task_unique_id=task.unique_id,
                result='<Interrupted />',
                created_at=datetime.now(timezone.utc).isoformat()
            ))
        else:
            # Use helper to convert Task to ToolCall (without children)
            remaining_pending_tool_calls.append(pending_leaf_task_to_tool_call(task))

    return log, remaining_pending_tool_calls


def get_pending_tool_calls(log: ConversationLog) -> List[ChatCompletionMessageToolCallParamMX]:
    """
    Extract pending tool calls from the latest root node onwards.
    A task is pending if it doesn't have a corresponding TaskResult.

    If a pending task has completed children, attaches child_tasks_batch to the
    tool call (not persisted to log, just for runtime execution).
    """
    pending_leaf_tasks = get_pending_leaf_tasks(log)

    # Build maps for efficient lookups
    latest_root_index, _ = get_latest_root(log)
    if latest_root_index is None:
        return []

    # Map of unique_id -> Task for all tasks from latest root
    task_map: Dict[str, Task] = {}
    for entry in log[latest_root_index:]:
        if entry.type_ == "task":
            task_map[entry.unique_id] = entry

    # Map of task_unique_id -> result for all completed tasks
    result_map: Dict[str, Any] = {}
    for entry in log[latest_root_index:]:
        if entry.type_ == "task_result":
            result_map[entry.task_unique_id] = entry.result

    # Convert tasks to tool calls with child_tasks_batch attached
    pending_tool_calls = [
        pending_leaf_task_to_tool_call(task, task_map=task_map, result_map=result_map)
        for task in pending_leaf_tasks
    ]

    return pending_tool_calls


def get_completed_tool_calls(
    full_log: ConversationLog,
    from_index: int
) -> CompletedToolCallsMXWithRunId:
    """
    Extract completed tool calls from the log.
    Only returns tool calls where the TaskResult was added after from_index (newly completed).
    Returns a list of complete tool messages that include both call and response information.
    """
    # Build map of task_unique_id -> Task from FULL log
    task_map: Dict[str, Task] = {}
    for entry in full_log:
        if entry.type_ == "task":
            task_map[entry.unique_id] = entry

    # Collect TaskResults that are NEW (after from_index)
    new_results: List[TaskResult] = []
    for i, entry in enumerate(full_log):
        if i >= from_index and entry.type_ == "task_result":
            new_results.append(entry)

    # Build list of completed tool calls
    completed_tool_calls: List[ChatCompletionToolMessageParamMXWithRunId] = []

    for result in new_results:
        task = task_map.get(result.task_unique_id)
        if not task:
            continue  # Skip if Task not found (shouldn't happen)

        # Create complete tool message with both call and response info
        tool_message = cast(ChatCompletionToolMessageParamMXWithRunId, {
            "role": "tool",
            "tool_call_id": task.unique_id,
            "content": result.result,
            "run_id": task.run_id,
            "function": {
                "name": task.agent,
                "arguments": task.args  # No need for json.dumps - HTTP response handles serialization
            },
            "created_at": result.created_at
        })

        completed_tool_calls.append(tool_message)

    return completed_tool_calls
