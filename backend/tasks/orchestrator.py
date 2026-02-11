"""Core orchestration engine with append-only conversation log."""

import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import inspect
import secrets
import time
from typing import Dict, List, Optional, Set, Type, Union, Callable, Literal
from pydantic import BaseModel, Field, ConfigDict
from pydantic.fields import FieldInfo
from pydantic_core import PydanticUndefined

from .debug_context import TaskDebug, LLMDebug, get_task_debug, set_task_debug
from .utils.helpers import short_hash


def generate_unique_tool_call_id() -> str:
    return f"mxgen_{secrets.token_hex(12)}"


def normalize_agent_args(agent_cls: Type, args: dict) -> tuple[dict, list[str]]:
    """Normalize agent arguments by extracting actual defaults from FieldInfo objects."""
    sig = inspect.signature(agent_cls.__init__)
    normalized_args = args.copy()
    missing_required = []

    for name, param in sig.parameters.items():
        if name in ("self", "_unique_id", "orchestrator", "args", "kwargs"):
            continue

        if name not in normalized_args and isinstance(param.default, FieldInfo):
            field_info = param.default

            if field_info.default_factory is not None:
                normalized_args[name] = field_info.default_factory()
            elif field_info.default not in [..., PydanticUndefined]:
                normalized_args[name] = field_info.default
            else:
                missing_required.append(name)

    return normalized_args, missing_required


# ============================================================================
# Log Models (immutable, for API serialization)
# ============================================================================

class Task(BaseModel):
    """Immutable task entry for conversation log."""
    model_config = ConfigDict(protected_namespaces=(), populate_by_name=True)

    type_: Literal["task"] = Field(default="task", alias="_type")
    parent_unique_id: Optional[str] = Field(default=None, alias="_parent_unique_id")
    previous_unique_id: Optional[str] = Field(default=None, alias="_previous_unique_id")
    run_id: str = Field(alias="_run_id")
    agent: str
    args: dict = Field(default_factory=dict)
    unique_id: str
    created_at: str  # ISO timestamp


class TaskResult(BaseModel):
    """Immutable result entry for conversation log."""
    model_config = ConfigDict(protected_namespaces=(), populate_by_name=True)

    type_: Literal["task_result"] = Field(default="task_result", alias="_type")
    task_unique_id: str = Field(alias="_task_unique_id")
    result: Optional[Union[dict, str]] = None
    created_at: str  # ISO timestamp


class TaskDebugLog(BaseModel):
    """Immutable debug entry for conversation log."""
    model_config = ConfigDict(protected_namespaces=(), populate_by_name=True)

    type_: Literal["task_debug"] = Field(default="task_debug", alias="_type")
    task_unique_id: str = Field(alias="_task_unique_id")
    duration: float = 0
    llmDebug: List[LLMDebug] = Field(default_factory=list)
    extra: Optional[dict] = None
    created_at: str  # ISO timestamp


ConversationLog = List[Union[Task, TaskResult, TaskDebugLog]]


# ============================================================================
# Compressed Task (mutable, for runtime operations)
# ============================================================================

class CompressedTask:
    """Mutable task for orchestrator operations (reconstructed from log)."""
    def __init__(self, parent_unique_id: Optional[str], previous_unique_id: Optional[str], run_id: str,
                 agent: str, args: dict, unique_id: str):
        self.parent_unique_id = parent_unique_id
        self.previous_unique_id = previous_unique_id
        self.run_id = run_id
        self.agent = agent
        self.args = args
        self.unique_id = unique_id
        self.debug = TaskDebug()
        self.child_unique_ids: List[List[str]] = []
        self.result: Optional[Union[dict, str]] = None


# ============================================================================
# Compressed Conversation Log
# ============================================================================

class CompressedConversationLog:
    """Maintains mutable tasks + append-only log."""

    def __init__(self, log: Optional[ConversationLog] = None):
        self.tasks: Dict[str, CompressedTask] = {}
        self.log: ConversationLog = []
        self._log_start_index: int = 0

        if log:
            self._rebuild_from_log(log)

    def _rebuild_from_log(self, log: ConversationLog):
        """Rebuild compressed tasks from log entries."""
        self.log = log.copy()
        self._log_start_index = len(log)

        for entry in log:
            if entry.type_ == "task":
                task = CompressedTask(
                    parent_unique_id=entry.parent_unique_id,
                    previous_unique_id=entry.previous_unique_id,
                    run_id=entry.run_id,
                    agent=entry.agent,
                    args=entry.args,
                    unique_id=entry.unique_id
                )
                self.tasks[task.unique_id] = task

            elif entry.type_ == "task_result":
                if entry.task_unique_id in self.tasks:
                    self.tasks[entry.task_unique_id].result = entry.result

            elif entry.type_ == "task_debug":
                # Don't accumulate - each log entry is a delta
                # task.debug stays empty; frontend will aggregate
                pass

        for unique_id, task in self.tasks.items():
            if task.parent_unique_id is not None:
                parent = self.tasks.get(task.parent_unique_id)
                if parent:
                    for batch in parent.child_unique_ids:
                        if batch and self.tasks[batch[0]].run_id == task.run_id:
                            batch.append(task.unique_id)
                            break
                    else:
                        parent.child_unique_ids.append([task.unique_id])

    def add_task(self, task: CompressedTask, orchestrator: Optional['Orchestrator'] = None):
        """Add task to tasks dict AND append Task entry to log."""
        self.tasks[task.unique_id] = task

        log_entry = Task(
            parent_unique_id=task.parent_unique_id,
            previous_unique_id=task.previous_unique_id,
            run_id=task.run_id,
            agent=task.agent,
            args=task.args,
            unique_id=task.unique_id,
            created_at=datetime.now(timezone.utc).isoformat()
        )
        self.log.append(log_entry)

        # Call streaming callback if provided
        if orchestrator and orchestrator.onToolCreated:
            orchestrator.onToolCreated(task)

    def assign_result(self, task_unique_id: str, result: Union[dict, str], orchestrator: Optional['Orchestrator'] = None):
        """Update task result AND append TaskResult to log."""
        self.tasks[task_unique_id].result = result

        log_entry = TaskResult(
            task_unique_id=task_unique_id,
            result=result,
            created_at=datetime.now(timezone.utc).isoformat()
        )
        self.log.append(log_entry)

        # Call streaming callback if provided
        if orchestrator and orchestrator.onToolCompleted:
            orchestrator.onToolCompleted(self.tasks[task_unique_id])

    def add_debug(self, task_unique_id: str, debug: TaskDebug):
        """Update task debug AND append TaskDebugLog to log."""
        self.tasks[task_unique_id].debug = debug

        log_entry = TaskDebugLog(
            task_unique_id=task_unique_id,
            duration=debug.duration,
            llmDebug=debug.llmDebug,
            extra=getattr(debug, 'extra', None),
            created_at=datetime.now(timezone.utc).isoformat()
        )
        self.log.append(log_entry)

    def get_log_diff(self) -> ConversationLog:
        """Get log entries added since initialization."""
        return self.log[self._log_start_index:]

# ============================================================================
# Agent Classes
# ============================================================================

class AgentCall(BaseModel):
    agent: str
    args: dict = Field(default_factory=dict)
    unique_id: Optional[str] = None
    error: Optional[str] = None


class Agent:
    def __init__(self, _unique_id: str, orchestrator: "Orchestrator", *args, **kwargs):
        self._unique_id = _unique_id
        self._orchestrator = orchestrator

    async def reduce(self, child_batches: List[List["CompressedTask"]]):
        raise NotImplementedError("This method should be implemented by subclasses")

    async def dispatch(self, agent: AgentCall | List[AgentCall]):
        await self._orchestrator.run(agent, self._unique_id)
        await self.reduce(self._orchestrator.get_children(self._unique_id))

    async def run(self) -> Union[str, dict]:
        raise NotImplementedError("This method should be implemented by subclasses")


class Tool(Agent):
    def __init__(self, _unique_id: str, orchestrator: "Orchestrator", *args, **kwargs):
        super().__init__(_unique_id, orchestrator)

    async def reduce(self, child_batches: List[List["CompressedTask"]]):
        return

    async def run(self) -> Union[str, dict]:
        raise NotImplementedError("This method should be implemented by subclasses")


class UserInputException(Exception):
    def __init__(self, task_unique_ids: str | List[str]):
        self.task_unique_ids = task_unique_ids if isinstance(task_unique_ids, list) else [task_unique_ids]
        super().__init__(f"User input required for tasks: {self.task_unique_ids}")


# ============================================================================
# Orchestrator
# ============================================================================

class Orchestrator:
    _agent_registry: dict[str, Type[Agent]] = {}

    def __init__(self, log: Optional[ConversationLog] = None,
                 onMessage: Optional[Callable[[dict], None]] = None,
                 onContent: Optional[Callable[[str, str], None]] = None,
                 onToolCreated: Optional[Callable[[CompressedTask], None]] = None,
                 onToolCompleted: Optional[Callable[[CompressedTask], None]] = None):
        self.compressed = CompressedConversationLog(log)
        self.onMessage = onMessage
        self.onContent = onContent
        self.onToolCreated = onToolCreated
        self.onToolCompleted = onToolCompleted

    @classmethod
    def register_agents(cls, agent_classes: List[Type[Agent]]):
        for cls_ in agent_classes:
            cls._agent_registry[cls_.__name__] = cls_

    @classmethod
    def get_agent(cls, name: str) -> Type[Agent]:
        if name not in cls._agent_registry:
            raise ValueError(f"Agent '{name}' not found.")
        return cls._agent_registry[name]

    async def run(self, agent: AgentCall | List[AgentCall], parent_unique_id: Optional[str] = None, previous_unique_id: Optional[str] = None):
        """Run one or more agents in parallel."""
        agents = agent if isinstance(agent, list) else [agent]
        run_id = generate_unique_tool_call_id()
        tasks: List[CompressedTask] = []
        child_unique_ids = []

        for agent_call in agents:
            unique_id = agent_call.unique_id or generate_unique_tool_call_id()
            task = CompressedTask(
                parent_unique_id=parent_unique_id,
                previous_unique_id=previous_unique_id,
                run_id=run_id,
                unique_id=unique_id,
                agent=agent_call.agent,
                args=agent_call.args,
            )
            if agent_call.error:
                task.result = agent_call.error

            self.compressed.add_task(task, self)
            tasks.append(task)
            child_unique_ids.append(unique_id)

        if parent_unique_id is not None:
            self.compressed.tasks[parent_unique_id].child_unique_ids.append(child_unique_ids)

        async def run_single(task: CompressedTask):
            if task.result is not None:
                return

            args = deepcopy(task.args)
            if "_unique_id" in args or "orchestrator" in args:
                raise ValueError(f"Agent arguments cannot contain '_unique_id' or 'orchestrator'. Agent: {task.agent}")

            agent_cls = self.get_agent(task.agent)
            args, missing_params = normalize_agent_args(agent_cls, args)

            if missing_params:
                self.compressed.assign_result(
                    task.unique_id,
                    f"<ERROR>Required parameters missing: {', '.join(missing_params)}</ERROR>",
                    self
                )
                return

            agent_instance = agent_cls(_unique_id=task.unique_id, orchestrator=self, **args)
            await agent_instance.reduce(self.get_children(task.unique_id))

            with set_task_debug(task.debug):
                if self.onMessage:
                    self.onMessage({
                        "type": "message",
                        "content": {"agent": task.agent, "args": args, "task_unique_id": task.unique_id}
                    })

                start = time.perf_counter()
                try:
                    result = await agent_instance.run()
                    self.compressed.assign_result(task.unique_id, result, self)

                finally:
                    duration = time.perf_counter() - start
                    task_debug = get_task_debug()
                    task_debug.duration = duration
                    self.compressed.add_debug(task.unique_id, task_debug)

        results = await asyncio.gather(
            *[run_single(task) for task in tasks],
            return_exceptions=True
        )
        self._handle_exceptions(results)

    async def resume(self):
        """Resume pending tasks after user input."""
        _processing_unique_ids: Set[str] = set()

        async def resume_pending_task(task: CompressedTask, child_tasks_duration=0):
            if task.unique_id in _processing_unique_ids or task.result is not None:
                return

            child_tasks = self.get_children(task.unique_id)
            if any(child.result is None for group in child_tasks for child in group):
                return

            _processing_unique_ids.add(task.unique_id)

            agent_cls = self.get_agent(task.agent)
            args = task.args
            args, missing_params = normalize_agent_args(agent_cls, args)

            if missing_params:
                self.compressed.assign_result(
                    task.unique_id,
                    f"<ERROR>Required parameters missing: {', '.join(missing_params)}</ERROR>",
                    self
                )
                return

            agent_instance = agent_cls(_unique_id=task.unique_id, orchestrator=self, **args)
            await agent_instance.reduce(child_tasks)

            with set_task_debug(task.debug):
                if self.onMessage:
                    self.onMessage({
                        "type": "message",
                        "content": {"agent": task.agent, "args": task.args}
                    })

                start = time.perf_counter()
                try:
                    result = await agent_instance.run()
                    self.compressed.assign_result(task.unique_id, result, self)

                finally:
                    duration = time.perf_counter() - start
                    task_debug = get_task_debug()
                    task_debug.duration = duration + child_tasks_duration  # Delta for this phase only
                    self.compressed.add_debug(task.unique_id, task_debug)
                    child_tasks_duration += duration

            if task.parent_unique_id is not None:
                await resume_pending_task(self.compressed.tasks[task.parent_unique_id], child_tasks_duration)

        results = await asyncio.gather(
            *[resume_pending_task(task) for task in self._get_leaf_pending_tasks()],
            return_exceptions=True
        )
        self._handle_exceptions(results)

    def _handle_exceptions(self, results: List[None | Exception]):
        task_unique_ids = []
        for result in results:
            if not result:
                continue
            if isinstance(result, UserInputException):
                task_unique_ids.extend(result.task_unique_ids)
            else:
                raise result
        if task_unique_ids:
            raise UserInputException(task_unique_ids)

    def _get_leaf_pending_tasks(self) -> List[CompressedTask]:
        """Get pending tasks with no pending children."""
        parent_unique_ids = {
            task.parent_unique_id
            for task in self.compressed.tasks.values()
            if task.result is None and task.parent_unique_id is not None
        }
        return [
            task
            for task in self.compressed.tasks.values()
            if task.result is None and task.unique_id not in parent_unique_ids
        ]

    def get_children(self, unique_id: str) -> List[List[CompressedTask]]:
        """Get children of a task, grouped by run_id."""
        task = self.compressed.tasks.get(unique_id)
        if not task:
            raise ValueError("Task unique_id not found")
        return [
            [deepcopy(self.compressed.tasks[uid]) for uid in group]
            for group in task.child_unique_ids
        ]

    def get_previous_root_tasks(self) -> List[CompressedTask]:
        """Get previous root tasks by following the previous_unique_id linked list."""
        # Find the latest root task
        latest_root = next((t for t in reversed(list(self.compressed.tasks.values())) if t.parent_unique_id is None), None)
        if not latest_root:
            return []

        # Follow the linked list backwards
        previous_roots = []
        current_id = latest_root.previous_unique_id
        while current_id is not None:
            task = self.compressed.tasks.get(current_id)
            if task:
                previous_roots.append(task)
                current_id = task.previous_unique_id
            else:
                break

        return previous_roots


def register_agent(cls):
    Orchestrator.register_agents([cls])
    return cls
