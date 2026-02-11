"""
Task orchestration system for MinusX

This package provides a flexible agent-based orchestration framework for executing
complex multi-step tasks with LLM-powered agents.
"""

from .orchestrator import (
    Agent,
    AgentCall,
    Orchestrator,
    Task,
    Tool,
    UserInputException,
    register_agent,
)
from .debug_context import TaskDebug, TaskDebugLevel, LLMDebug, set_task_debug, get_task_debug
from .types import ChatCompletionMessageParamMX, ChatCompletionMessageToolCallParamMX, ChatCompletionToolMessageParamMX

# Import test agents to register them
from . import test_agents

# Import minusx analyst agent to register it
from .agents import atlas_analyst

# Rebuild ALLMRequest model now that Tool is defined
# This resolves the forward reference in ALLMRequest.tools: List[Type["Tool"]]
from .llm.models import ALLMRequest
ALLMRequest.model_rebuild()

__all__ = [
    "Agent",
    "AgentCall",
    "Orchestrator",
    "Task",
    "Tool",
    "UserInputException",
    "register_agent",
    "TaskDebug",
    "TaskDebugLevel",
    "LLMDebug",
    "set_task_debug",
    "get_task_debug",
    "ChatCompletionMessageParamMX",
    "ChatCompletionMessageToolCallParamMX",
    "ChatCompletionToolMessageParamMX",
]
