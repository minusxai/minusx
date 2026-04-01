"""TestAgent - Eval runner agent for context quality testing."""

from typing import Optional, List
from tasks import register_agent
from tasks.llm.config import MAX_STEPS_LOWER_LEVEL
from .agent import AnalystAgent
from .tools import SubmitBinary, SubmitNumber, SubmitString, CannotAnswer


@register_agent
class TestAgent(AnalystAgent):
    """
    Test Agent for running evals against context files.

    Subclass of AnalystAgent that terminates as soon as SubmitBinary
    or SubmitQuery is called. Exposes only the tools relevant for the
    assertion type.
    """

    def __init__(
        self,
        assertion: Optional[dict] = None,
        **kwargs
    ):
        super().__init__(**kwargs)
        self.assertion = assertion or {}
        self.submit_called = False

    def _get_system_message(self) -> dict:
        """Extend system message to instruct the agent to submit its answer."""
        base = super()._get_system_message()

        preamble = (
            "\n\n## Eval Mode\n"
            "Once you have your answer, "
            "call the Submit tool and the conversation. "
            "Do NOT edit or create any files.\n\n"
        )

        assertion_type = self.assertion.get('type', 'binary')
        if assertion_type == 'binary':
            submit_instruction = preamble + (
                "Submit tool: call SubmitBinary(answer=True) if the answer is yes/correct, "
                "or SubmitBinary(answer=False) if the answer is no/incorrect. "
                "If the data is insufficient to answer, call CannotAnswer(reason=...) instead."
            )
        elif assertion_type == 'string_match':
            submit_instruction = preamble + (
                "Submit tool: call SubmitString(answer=<string>) with your computed string answer. "
                "If the data is insufficient to answer, call CannotAnswer(reason=...) instead."
            )
        else:
            submit_instruction = preamble + (
                "Submit tool: call SubmitNumber(answer=<float>) with your computed numeric answer. "
                "If the data is insufficient to answer, call CannotAnswer(reason=...) instead."
            )

        return {
            "role": "system",
            "content": base["content"] + submit_instruction
        }

    def _get_available_tools(self):
        """Full AnalystAgent tool set plus the appropriate Submit tool for this assertion type."""
        if self.submit_called or len(self.tool_thread) >= MAX_STEPS_LOWER_LEVEL - 5:
            return []

        tools = list(super()._get_available_tools())
        assertion_type = self.assertion.get('type', 'binary')
        if assertion_type == 'binary':
            tools.append(SubmitBinary)
        elif assertion_type == 'number_match':
            tools.append(SubmitNumber)
        elif assertion_type == 'string_match':
            tools.append(SubmitString)
        tools.append(CannotAnswer)
        return tools

    async def reduce(self, child_batches):
        """Detect submit tool call in new thread entries."""
        prev_len = len(self.tool_thread)
        await super().reduce(child_batches)

        for entry in self.tool_thread[prev_len:]:
            if entry.get('role') == 'assistant':
                for tc in entry.get('tool_calls', []):
                    fn_name = tc.get('function', {}).get('name', '')
                    if fn_name in ('SubmitBinary', 'SubmitNumber', 'SubmitString', 'CannotAnswer'):
                        self.submit_called = True

    async def run(self) -> dict:
        """Same loop as AnalystAgent but stops after submit is called."""
        from tasks.chat_thread_processor import tool_calls_to_agent_calls  # noqa: PLC0415
        from tasks.llm.client import allm_request as real_allm_request  # noqa: PLC0415
        from tasks.llm.models import ALLMRequest, LlmSettings, UserInfo  # noqa: PLC0415
        from tasks.llm.config import ANALYST_V2_MODEL  # noqa: PLC0415
        from .agent import allm_request  # noqa: PLC0415

        thread_history = self._get_history()
        base_messages = [self._get_system_message()] + thread_history + [self._get_user_message()]

        while not self.submit_called and len(self.tool_thread) < MAX_STEPS_LOWER_LEVEL:
            messages = base_messages + self.tool_thread
            available_tools = self._get_available_tools()

            llm_settings = LlmSettings(
                model=ANALYST_V2_MODEL,
                response_format={"type": "text"},
                tool_choice="auto",
            )

            response, _ = await allm_request(
                ALLMRequest(
                    messages=messages,
                    llmSettings=llm_settings,
                    tools=available_tools,
                    userInfo=UserInfo(city=self.city) if self.city else None
                ),
                on_content=self._orchestrator.onContent if self._orchestrator else None
            )

            tool_calls = response.get("tool_calls", [])
            content = response.get("content", "")
            citations = response.get("citations", [])
            content_blocks = response.get("content_blocks", None)
            agent_calls = tool_calls_to_agent_calls(tool_calls, content, citations, content_blocks)
            finish_reason = response.get("finish_reason", "")

            if finish_reason in ("stop", "length"):
                return {"success": True, "content": content or "No answer submitted."}

            if agent_calls:
                await self.dispatch(agent_calls)

        return {"success": True}
