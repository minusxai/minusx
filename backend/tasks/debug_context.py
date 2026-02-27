"""Debug context management for task execution tracking."""

from contextlib import contextmanager
import contextvars
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel

task_debug_var = contextvars.ContextVar("task_debug")


class LLMDebug(BaseModel):
    """Debug information for a single LLM API call."""
    model: str
    duration: float
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    cost: float
    completion_tokens_details: Optional[dict] = None
    prompt_tokens_details: Optional[dict] = None
    finish_reason: Optional[str] = None
    lllm_call_id: Optional[str] = None
    lllm_overhead_time_ms: Optional[float] = None


class TaskDebug(BaseModel):
    """Debug information for a task execution (including all LLM calls)."""
    duration: float = 0
    llmDebug: List[LLMDebug] = []


class TaskDebugLevel(Enum):
    """Debug level configuration."""
    NONE = 0
    STATS = 1
    LLM_STATS = 2
    ALL = 3


@contextmanager
def set_task_debug(debug: Optional[TaskDebug] = None):
    """
    Context manager to set task debug information for the current context.

    Args:
        debug: TaskDebug object to use (creates new one if None)

    Yields:
        None

    Example:
        with set_task_debug():
            # LLM calls in this context will be tracked
            await agent.run()
    """
    debug = debug or TaskDebug()
    token = task_debug_var.set(debug)
    try:
        yield
    finally:
        task_debug_var.reset(token)


def get_task_debug() -> TaskDebug:
    """
    Get the current task debug information from context.

    Returns:
        TaskDebug object from context, or new empty TaskDebug if not set
    """
    try:
        return task_debug_var.get()
    except LookupError:
        return TaskDebug()
