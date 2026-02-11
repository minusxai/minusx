"""
Test agents for conversation API testing.
"""
from tasks import Agent, Tool, register_agent, UserInputException, AgentCall
from tasks.chat_thread_processor import root_tasks_to_thread


@register_agent
class DefaultAgent(Agent):
    """Default test agent that returns a simple greeting."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    async def reduce(self, child_batches):
        """No child reduction needed for simple agent."""
        pass

    async def run(self) -> str:
        """Return a simple greeting message."""
        return "Hello! I'm the default agent. I received your message and I'm ready to help."


@register_agent
class EchoAgent(Agent):
    """Echo agent that repeats the user's message."""

    def __init__(self, message: str, **kwargs):
        super().__init__(**kwargs)
        self.message = message

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        return f"You said: {self.message}"


@register_agent
class SimpleTool(Tool):
    """Simple tool that returns a fixed string."""

    def __init__(self, value: str, **kwargs):
        super().__init__(**kwargs)
        self.value = value

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        return f"Tool result: {self.value}"


@register_agent
class UserInputTool(Tool):
    """Tool that requires user input (frontend must provide completion)."""

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        raise UserInputException(self._unique_id)


@register_agent
class UserInputToolBackend(Tool):
    """Tool that can be executed by the backend (simulates backend-executable tool)."""

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        raise UserInputException(self._unique_id)


@register_agent
class MultiToolAgent(Agent):
    """Agent that dispatches multiple UserInputTools and accesses conversation history."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.child_count = 0

        # Access previous conversation history
        previous_root_tasks = self._orchestrator.get_previous_root_tasks()
        if previous_root_tasks:
            self.previous_thread = root_tasks_to_thread(previous_root_tasks, self._orchestrator)
        else:
            self.previous_thread = None

    async def reduce(self, child_batches):
        """Reduce must be idempotent."""
        flat_tasks = [task for batch in child_batches for task in batch]
        self.child_count = len(flat_tasks)

    async def run(self) -> str:
        # If we have previous thread context, return its length as proof
        if self.previous_thread:
            return str(len(self.previous_thread))

        # Original logic for first conversation turn
        if self.child_count == 0:
            # Dispatch one UserInputTool (requires frontend) and one UserInputToolBackend (backend can execute)
            await self.dispatch([
                AgentCall(agent="UserInputTool", args={}),
                AgentCall(agent="UserInputToolBackend", args={}),
            ])
        if self.child_count == 1:
            await self.dispatch(AgentCall(agent="UserInputTool", args={}))
        return "All tools completed"
