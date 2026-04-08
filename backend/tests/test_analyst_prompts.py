"""Test prompt loading, composition, and page-aware skill preloading."""

import json
import os
import shutil
from pathlib import Path

import pytest
from tasks.agents.analyst.prompt_loader import PromptLoader, get_skill, list_skills
from tasks.agents.analyst.agent import (
    AnalystAgent, PAGE_SKILL_MAP, DEFAULT_PRELOADED_SKILLS,
)
from tasks.agents.analyst.tools import (
    ReadFiles, EditFile, ExecuteQuery, PublishAll, Navigate,
    Clarify, SearchDBSchema, SearchFiles, CreateFile, LoadSkill,
)
from tasks.llm.client import describe_tool


# ── Helpers ──────────────────────────────────────────────────────────

LOADER = PromptLoader()

SAMPLE_SCHEMA = '- table: orders\n  columns: [id, customer_id, total, created_at]'
SAMPLE_CONTEXT = 'This is a sample e-commerce database.'


def _build_system_prompt(preloaded_skill_names: list[str] | None = None, **overrides) -> str:
    """Build a fully-resolved default system prompt for testing."""
    if preloaded_skill_names is None:
        preloaded_skill_names = list(DEFAULT_PRELOADED_SKILLS)
    preloaded_set = set(preloaded_skill_names)
    defaults = {
        'agent_name': 'MinusX',
        'schema': SAMPLE_SCHEMA,
        'context': SAMPLE_CONTEXT,
        'connection_id': 'test-connection-123',
        'home_folder': '/org',
        'max_steps': 10,
        'skills_catalog': AnalystAgent._build_skills_catalog(preloaded_set),
        'preloaded_skills': AnalystAgent._build_preloaded_skills_content(preloaded_skill_names),
    }
    defaults.update(overrides)
    return LOADER.get('default.system', **defaults)


def _build_app_state(page_type: str) -> dict:
    """Build a minimal app_state dict for a given page type."""
    if page_type == "explore":
        return {"type": "explore", "state": None}
    if page_type in ("folder", "slack"):
        return {"type": page_type, "state": {"files": [], "loading": False, "error": None}}
    return {
        "type": "file",
        "state": {
            "fileState": {
                "id": 1, "name": f"Test {page_type}",
                "path": f"/org/test-{page_type}", "type": page_type,
                "isDirty": False, "content": {}
            },
            "references": [], "queryResults": []
        }
    }


def _make_agent(page_type: str | None) -> AnalystAgent:
    """Create an AnalystAgent with minimal app_state (skips orchestrator)."""
    agent = object.__new__(AnalystAgent)
    agent.app_state = _build_app_state(page_type) if page_type else {}
    return agent


# ── Core prompt composition ──────────────────────────────────────────

class TestPromptComposition:
    """System and user prompts resolve without errors and contain expected content."""

    def test_system_prompt_resolves(self):
        prompt = _build_system_prompt()
        assert len(prompt) > 0

    def test_system_prompt_contains_core_sections(self):
        prompt = _build_system_prompt()
        for expected in ['MinusX', 'orders', 'e-commerce', 'test-connection-123',
                         '/org', 'ReadFiles', 'EditFile', 'SearchDBSchema', 'LoadSkill']:
            assert expected in prompt, f"Missing '{expected}' in system prompt"

    def test_user_prompt_resolves(self):
        prompt = LOADER.get(
            'default.user',
            app_state='{"type":"explore","state":null}',
            goal='Show me revenue',
            current_date='2026-04-04',
            attachments='',
        )
        assert 'Show me revenue' in prompt
        assert '2026-04-04' in prompt


# ── Page-aware skill preloading ──────────────────────────────────────

class TestPageAwarePreloading:
    """The agent preloads the right skills based on app_state page type."""

    @pytest.mark.parametrize("page_type,expected_skills", list(PAGE_SKILL_MAP.items()))
    def test_page_type_maps_to_correct_skills(self, page_type, expected_skills):
        agent = _make_agent(page_type)
        assert agent._get_preloaded_skill_names() == expected_skills

    def test_unknown_page_type_uses_defaults(self):
        agent = _make_agent(None)
        assert agent._get_preloaded_skill_names() == list(DEFAULT_PRELOADED_SKILLS)

    @pytest.mark.parametrize("page_type,expected_skills", list(PAGE_SKILL_MAP.items()))
    def test_preloaded_skill_content_present_in_prompt(self, page_type, expected_skills):
        prompt = _build_system_prompt(preloaded_skill_names=expected_skills)
        for skill_name in expected_skills:
            skill_content = get_skill(skill_name)
            assert skill_content is not None
            first_line = skill_content.strip().split('\n')[0]
            assert first_line in prompt, (
                f"Skill '{skill_name}' content not found in prompt for page '{page_type}'"
            )

    @pytest.mark.parametrize("page_type,expected_skills", list(PAGE_SKILL_MAP.items()))
    def test_preloaded_skills_excluded_from_catalog(self, page_type, expected_skills):
        catalog = AnalystAgent._build_skills_catalog(set(expected_skills))
        for skill_name in expected_skills:
            assert f'"{skill_name}"' not in catalog

    @pytest.mark.parametrize("page_type,expected_skills", list(PAGE_SKILL_MAP.items()))
    def test_non_preloaded_skills_in_catalog(self, page_type, expected_skills):
        preloaded_set = set(expected_skills)
        catalog = AnalystAgent._build_skills_catalog(preloaded_set)
        for skill_name in list_skills():
            if skill_name not in preloaded_set:
                assert f'"{skill_name}"' in catalog


# ── Skill content integrity ──────────────────────────────────────────

class TestSkillContentIntegrity:
    """Every defined skill loads successfully and contains meaningful content."""

    @pytest.mark.parametrize("skill_name", list(list_skills().keys()))
    def test_skill_loads_and_has_content(self, skill_name):
        content = get_skill(skill_name)
        assert content is not None, f"Skill '{skill_name}' returned None"
        assert len(content.strip()) > 50, f"Skill '{skill_name}' content suspiciously short"

    def test_all_page_skills_exist(self):
        all_skills = list_skills()
        for page_type, skill_names in PAGE_SKILL_MAP.items():
            for skill_name in skill_names:
                assert skill_name in all_skills, (
                    f"PAGE_SKILL_MAP references '{skill_name}' for page '{page_type}', but skill not found"
                )


# ── Slack agent ──────────────────────────────────────────────────────

class TestSlackPrompt:
    """Slack agent prompt resolves and contains slack-specific content."""

    def test_slack_addendum_resolves(self):
        prompt = LOADER.get('slack_addendum')
        assert len(prompt) > 0

    def test_slack_addendum_contains_key_content(self):
        prompt = LOADER.get('slack_addendum')
        assert 'Slack' in prompt
        assert 'vizSettings' in prompt or 'chart' in prompt.lower()
        assert 'plain text' in prompt  # instructs to reply as plain text only


# ── Report agent ─────────────────────────────────────────────────────

class TestReportPrompt:
    """Report synthesis prompts resolve and contain expected placeholders."""

    def test_report_system_resolves(self):
        prompt = LOADER.get('report_synthesis.system')
        assert 'report' in prompt.lower()

    def test_report_user_resolves(self):
        prompt = LOADER.get(
            'report_synthesis.user',
            report_name='Q1 Revenue Report',
            analyses_text='### Sales\nRevenue was $1M',
            queries_text='No queries available',
            report_prompt='Summarize key findings',
        )
        assert 'Q1 Revenue Report' in prompt
        assert 'Revenue was $1M' in prompt
        assert 'Summarize key findings' in prompt
        assert 'query:TOOL_CALL_ID' in prompt


# ── Eval/test agent ─────────────────────────────────────────────────

class TestEvalPrompt:
    """Eval addendum prompts resolve for each assertion type."""

    def test_eval_preamble_resolves(self):
        prompt = LOADER.get('eval_addendum.preamble')
        assert 'Eval Mode' in prompt

    @pytest.mark.parametrize("assertion_type,expected_tool", [
        ("binary", "SubmitBinary"),
        ("number_match", "SubmitNumber"),
        ("string_match", "SubmitString"),
    ])
    def test_eval_assertion_type_resolves(self, assertion_type, expected_tool):
        prompt = LOADER.get(f'eval_addendum.{assertion_type}')
        assert expected_tool in prompt
        assert 'CannotAnswer' in prompt


# ── Onboarding agents ───────────────────────────────────────────────

class TestOnboardingContextPrompt:
    """OnboardingContextAgent prompt resolves and contains context skill content."""

    def test_system_resolves(self):
        prompt = LOADER.get(
            'onboarding_context.system',
            agent_name='MinusX',
            schema=SAMPLE_SCHEMA,
            connection_id='test-conn',
            max_steps=15,
        )
        assert len(prompt) > 0

    def test_system_contains_context_skill(self):
        """The context editing rules from skill_contexts should be embedded."""
        prompt = LOADER.get(
            'onboarding_context.system',
            agent_name='MinusX',
            schema=SAMPLE_SCHEMA,
            connection_id='test-conn',
            max_steps=15,
        )
        # Context skill content should be inlined
        assert 'docs' in prompt
        assert 'EditFile' in prompt
        assert 'content' in prompt

    def test_system_contains_onboarding_specific_guidelines(self):
        """Onboarding-specific content that doesn't exist in the base context skill."""
        prompt = LOADER.get(
            'onboarding_context.system',
            agent_name='MinusX',
            schema=SAMPLE_SCHEMA,
            connection_id='test-conn',
            max_steps=15,
        )
        assert '100-300 words' in prompt
        assert 'What you can ask' in prompt
        assert 'SearchDBSchema' in prompt

    def test_user_resolves(self):
        prompt = LOADER.get(
            'onboarding_context.user',
            app_state='null',
            current_date='2026-04-04',
            goal='Document this database',
        )
        assert 'Document this database' in prompt


class TestOnboardingDashboardPrompt:
    """OnboardingDashboardAgent prompt resolves and contains dashboard skill content."""

    def test_system_resolves(self):
        prompt = LOADER.get(
            'onboarding_dashboard.system',
            agent_name='MinusX',
            schema=SAMPLE_SCHEMA,
            context=SAMPLE_CONTEXT,
            connection_id='test-conn',
            max_steps=25,
        )
        assert len(prompt) > 0

    def test_system_contains_dashboard_skill(self):
        """The dashboard structure from skill_dashboards should be embedded."""
        prompt = LOADER.get(
            'onboarding_dashboard.system',
            agent_name='MinusX',
            schema=SAMPLE_SCHEMA,
            context=SAMPLE_CONTEXT,
            connection_id='test-conn',
            max_steps=25,
        )
        assert '12-column grid' in prompt
        assert '"assets"' in prompt
        assert '"layout"' in prompt

    def test_system_contains_dashboard_templates(self):
        """Onboarding-specific dashboard templates should be present."""
        prompt = LOADER.get(
            'onboarding_dashboard.system',
            agent_name='MinusX',
            schema=SAMPLE_SCHEMA,
            context=SAMPLE_CONTEXT,
            connection_id='test-conn',
            max_steps=25,
        )
        assert 'Sales Performance Dashboard' in prompt
        assert 'Customer Analysis Dashboard' in prompt
        assert 'Ads Performance Dashboard' in prompt

    def test_system_contains_workflow(self):
        prompt = LOADER.get(
            'onboarding_dashboard.system',
            agent_name='MinusX',
            schema=SAMPLE_SCHEMA,
            context=SAMPLE_CONTEXT,
            connection_id='test-conn',
            max_steps=25,
        )
        assert 'CreateFile' in prompt
        assert 'EditFile' in prompt
        assert 'Getting Started Dashboard' in prompt

    def test_user_resolves(self):
        prompt = LOADER.get(
            'onboarding_dashboard.user',
            app_state='null',
            current_date='2026-04-04',
            goal='Build a starter dashboard',
        )
        assert 'Build a starter dashboard' in prompt


# ── File output for visual inspection ────────────────────────────────

OUTPUT_DIR = Path(__file__).parent / 'test_outputs' / 'prompts'


class TestWritePromptFiles:
    """Write resolved prompts to disk for inspection. Only keeps files when KEEP_TEST_PROMPTS=1."""

    @pytest.fixture(autouse=True)
    def _setup_output_dir(self):
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        yield
        if os.getenv('KEEP_TEST_PROMPTS', '0') != '1':
            shutil.rmtree(OUTPUT_DIR, ignore_errors=True)

    @pytest.mark.parametrize("page_type", list(PAGE_SKILL_MAP.keys()))
    def test_write_system_prompt_per_page(self, page_type):
        skills = PAGE_SKILL_MAP[page_type]
        prompt = _build_system_prompt(preloaded_skill_names=skills)
        (OUTPUT_DIR / f'system_{page_type}.txt').write_text(prompt)
        assert len(prompt) > 100

    def test_write_user_prompt(self):
        prompt = LOADER.get(
            'default.user',
            app_state='{"type":"file","state":{"fileState":{"type":"question"}}}',
            goal='Show me total revenue by month',
            current_date='2026-04-04',
            attachments='',
        )
        (OUTPUT_DIR / 'user.txt').write_text(prompt)
        assert 'Show me total revenue' in prompt

    def test_write_tools(self):
        tools = [ReadFiles, EditFile, ExecuteQuery, PublishAll, Navigate,
                 Clarify, SearchDBSchema, SearchFiles, CreateFile, LoadSkill]
        tool_schemas = [describe_tool(t) for t in tools]
        (OUTPUT_DIR / 'tools.txt').write_text(json.dumps(tool_schemas, indent=2))
        assert len(tool_schemas) == 10

    def test_write_slack_prompt(self):
        base = _build_system_prompt(preloaded_skill_names=["explore"])
        addendum = LOADER.get('slack_addendum')
        (OUTPUT_DIR / 'system_slack.txt').write_text(f"{base}\n\n{addendum}")

    def test_write_report_synthesis_prompt(self):
        system = LOADER.get('report_synthesis.system')
        user = LOADER.get(
            'report_synthesis.user',
            report_name='Sample Report',
            analyses_text='### Analysis 1\nSample analysis',
            queries_text='No queries available',
            report_prompt='Summarize findings',
        )
        (OUTPUT_DIR / 'report_synthesis_system.txt').write_text(system)
        (OUTPUT_DIR / 'report_synthesis_user.txt').write_text(user)

    def test_write_onboarding_context_prompt(self):
        prompt = LOADER.get(
            'onboarding_context.system',
            agent_name='MinusX', schema=SAMPLE_SCHEMA,
            connection_id='test-conn', max_steps=15,
        )
        (OUTPUT_DIR / 'onboarding_context_system.txt').write_text(prompt)

    def test_write_onboarding_dashboard_prompt(self):
        prompt = LOADER.get(
            'onboarding_dashboard.system',
            agent_name='MinusX', schema=SAMPLE_SCHEMA,
            context=SAMPLE_CONTEXT, connection_id='test-conn', max_steps=25,
        )
        (OUTPUT_DIR / 'onboarding_dashboard_system.txt').write_text(prompt)
