"""OnboardingAgent - Fast, focused agents for onboarding steps."""

import json
import time
from tasks import register_agent
from tasks.llm.config import MAX_STEPS_LOWER_LEVEL, ANALYST_V2_MODEL
from tasks.llm.models import LlmSettings
from .agent import AnalystAgent
from .prompt_loader import get_prompt
from .tools import SearchDBSchema, EditFile, ExecuteQuery, CreateFile


ONBOARDING_MAX_STEPS = 15  # Keep it fast — schema scan + a few edits
DASHBOARD_MAX_STEPS = 25  # More steps needed: create questions + build dashboard


@register_agent
class OnboardingContextAgent(AnalystAgent):
    """
    Lightweight agent for the onboarding context step.

    Reads the database schema via SearchDBSchema and writes markdown
    documentation into the context file via EditFile. Deliberately
    limited in tools and prompt length to keep latency low.
    """

    def _get_system_message(self) -> dict:
        schema_str = json.dumps(self.schema, indent=2) if self.schema else "No schema provided."
        max_steps = min(ONBOARDING_MAX_STEPS, MAX_STEPS_LOWER_LEVEL - 5)
        content = get_prompt(
            'onboarding_context.system',
            agent_name=self.agent_name,
            schema=schema_str,
            connection_id=self.connection_id,
            max_steps=max_steps,
        )
        return {"role": "system", "content": content}

    def _get_user_message(self) -> dict:
        app_state_str = json.dumps(self.app_state, separators=(',', ':')) if self.app_state else "null"
        content = get_prompt(
            'onboarding_context.user',
            app_state=app_state_str,
            current_date=time.strftime("%Y-%m-%d"),
            goal=self.goal,
        )
        return {"role": "user", "content": content}

    def _get_llm_settings(self) -> LlmSettings:
        return LlmSettings(
            model=ANALYST_V2_MODEL,
            response_format={"type": "text"},
            tool_choice="auto",
            include_web_search=False,
        )

    def _get_available_tools(self):
        if len(self.tool_thread) >= ONBOARDING_MAX_STEPS:
            return []
        return [SearchDBSchema, EditFile, ExecuteQuery]


@register_agent
class OnboardingDashboardAgent(AnalystAgent):
    """
    Agent for the onboarding dashboard step.

    Creates 3-4 questions with varied visualizations and assembles them
    into a starter dashboard. Uses CreateFile for questions, EditFile for
    the dashboard layout, and ExecuteQuery/SearchDBSchema for exploration.
    """

    def _get_system_message(self) -> dict:
        schema_str = json.dumps(self.schema, indent=2) if self.schema else "No schema provided."
        max_steps = min(DASHBOARD_MAX_STEPS, MAX_STEPS_LOWER_LEVEL - 5)
        content = get_prompt(
            'onboarding_dashboard.system',
            agent_name=self.agent_name,
            schema=schema_str,
            context=self.context,
            connection_id=self.connection_id,
            max_steps=max_steps,
        )
        return {"role": "system", "content": content}

    def _get_user_message(self) -> dict:
        app_state_str = json.dumps(self.app_state, separators=(',', ':')) if self.app_state else "null"
        content = get_prompt(
            'onboarding_dashboard.user',
            app_state=app_state_str,
            current_date=time.strftime("%Y-%m-%d"),
            goal=self.goal,
        )
        return {"role": "user", "content": content}

    def _get_llm_settings(self) -> LlmSettings:
        return LlmSettings(
            model=ANALYST_V2_MODEL,
            response_format={"type": "text"},
            tool_choice="auto",
            include_web_search=False,
        )

    def _get_available_tools(self):
        if len(self.tool_thread) >= DASHBOARD_MAX_STEPS:
            return []
        return [SearchDBSchema, ExecuteQuery, CreateFile, EditFile]
