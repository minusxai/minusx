"""FeedSummaryAgent - Simple no-tools agent that generates a short feed summary."""

import json
import time
from tasks import register_agent
from tasks.llm.config import CODING_MODEL, ONBOARDING_MODEL
from tasks.llm.models import LlmSettings
from .agent import AnalystAgent
from .prompt_loader import get_prompt


@register_agent
class FeedSummaryAgent(AnalystAgent):
    """
    Minimal agent that takes recent file metadata and produces a 2-3 sentence
    summary for the home feed. No tools — single LLM call, returns text.
    """

    def _get_system_message(self) -> dict:
        content = get_prompt('feed_summary.system', agent_name=self.agent_name)
        return {"role": "system", "content": content}

    def _get_user_message(self) -> dict:
        app_state_str = json.dumps(self.app_state, indent=2) if self.app_state else "null"
        print(f"[FeedSummaryAgent] app_state:\n{app_state_str}")
        content = get_prompt(
            'feed_summary.user',
            app_state=app_state_str,
            current_date=time.strftime("%Y-%m-%d"),
        )
        return {"role": "user", "content": content}

    def _get_llm_settings(self) -> LlmSettings:
        return LlmSettings(
            model=ONBOARDING_MODEL,
            response_format={"type": "text"},
            tool_choice="none",
            include_web_search=False,
        )

    def _get_available_tools(self):
        return []
