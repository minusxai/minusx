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

def _build_system_prompt(preloaded_skill_names: list[str] | None = None, **overrides) -> str:
    """Build a fully-resolved system prompt for testing."""
    loader = PromptLoader()
    if preloaded_skill_names is None:
        preloaded_skill_names = list(DEFAULT_PRELOADED_SKILLS)
    preloaded_set = set(preloaded_skill_names)
    defaults = {
        'agent_name': 'MinusX',
        'schema': '- table: orders\n  columns: [id, customer_id, total, created_at]',
        'context': 'This is a sample e-commerce database.',
        'connection_id': 'test-connection-123',
        'home_folder': '/org',
        'max_steps': 10,
        'skills_catalog': AnalystAgent._build_skills_catalog(preloaded_set),
        'preloaded_skills': AnalystAgent._build_preloaded_skills_content(preloaded_skill_names),
    }
    defaults.update(overrides)
    return loader.get('default.system', **defaults)


def _build_app_state(page_type: str) -> dict:
    """Build a minimal app_state dict for a given page type."""
    if page_type == "explore":
        return {"type": "explore", "state": None}
    if page_type == "folder":
        return {"type": "folder", "state": {"files": [], "loading": False, "error": None}}
    # File types: question, dashboard, context, report, alert
    return {
        "type": "file",
        "state": {
            "fileState": {
                "id": 1,
                "name": f"Test {page_type}",
                "path": f"/org/test-{page_type}",
                "type": page_type,
                "isDirty": False,
                "content": {}
            },
            "references": [],
            "queryResults": []
        }
    }


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
        loader = PromptLoader()
        prompt = loader.get(
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
        """Each page type resolves to the expected preloaded skill list."""
        agent = _make_agent(page_type)
        assert agent._get_preloaded_skill_names() == expected_skills

    def test_unknown_page_type_uses_defaults(self):
        agent = _make_agent(None)
        assert agent._get_preloaded_skill_names() == list(DEFAULT_PRELOADED_SKILLS)

    @pytest.mark.parametrize("page_type,expected_skills", list(PAGE_SKILL_MAP.items()))
    def test_preloaded_skill_content_present_in_prompt(self, page_type, expected_skills):
        """Preloaded skill content actually appears in the system prompt."""
        prompt = _build_system_prompt(preloaded_skill_names=expected_skills)
        for skill_name in expected_skills:
            # Each preloaded skill's content should be in the prompt
            skill_content = get_skill(skill_name)
            assert skill_content is not None
            # Check a snippet from the skill content is present
            first_line = skill_content.strip().split('\n')[0]
            assert first_line in prompt, (
                f"Skill '{skill_name}' content not found in prompt for page '{page_type}'"
            )

    @pytest.mark.parametrize("page_type,expected_skills", list(PAGE_SKILL_MAP.items()))
    def test_preloaded_skills_excluded_from_catalog(self, page_type, expected_skills):
        """Preloaded skills should NOT appear in the LoadSkill catalog."""
        catalog = AnalystAgent._build_skills_catalog(set(expected_skills))
        for skill_name in expected_skills:
            assert f'"{skill_name}"' not in catalog, (
                f"Preloaded skill '{skill_name}' should not be in LoadSkill catalog for page '{page_type}'"
            )

    @pytest.mark.parametrize("page_type,expected_skills", list(PAGE_SKILL_MAP.items()))
    def test_non_preloaded_skills_in_catalog(self, page_type, expected_skills):
        """Non-preloaded skills SHOULD appear in the LoadSkill catalog."""
        preloaded_set = set(expected_skills)
        catalog = AnalystAgent._build_skills_catalog(preloaded_set)
        all_skills = list_skills()
        for skill_name in all_skills:
            if skill_name not in preloaded_set:
                assert f'"{skill_name}"' in catalog, (
                    f"On-demand skill '{skill_name}' missing from catalog for page '{page_type}'"
                )


def _make_agent(page_type: str | None) -> AnalystAgent:
    """Create an AnalystAgent with a minimal app_state. Uses __new__ to skip __init__ orchestrator requirement."""
    agent = object.__new__(AnalystAgent)
    if page_type is None:
        agent.app_state = {}
    else:
        agent.app_state = _build_app_state(page_type)
    return agent


# ── Skill content integrity ──────────────────────────────────────────

class TestSkillContentIntegrity:
    """Every defined skill loads successfully and contains meaningful content."""

    @pytest.mark.parametrize("skill_name", list(list_skills().keys()))
    def test_skill_loads_and_has_content(self, skill_name):
        content = get_skill(skill_name)
        assert content is not None, f"Skill '{skill_name}' returned None"
        assert len(content.strip()) > 50, f"Skill '{skill_name}' content suspiciously short"

    def test_all_page_skills_exist(self):
        """Every skill referenced in PAGE_SKILL_MAP actually exists."""
        all_skills = list_skills()
        for page_type, skill_names in PAGE_SKILL_MAP.items():
            for skill_name in skill_names:
                assert skill_name in all_skills, (
                    f"PAGE_SKILL_MAP references '{skill_name}' for page '{page_type}', but skill not found"
                )


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
        """Write a system prompt file for each page type."""
        skills = PAGE_SKILL_MAP[page_type]
        prompt = _build_system_prompt(preloaded_skill_names=skills)
        path = OUTPUT_DIR / f'system_{page_type}.txt'
        path.write_text(prompt)
        assert len(prompt) > 100

    def test_write_user_prompt(self):
        loader = PromptLoader()
        prompt = loader.get(
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
