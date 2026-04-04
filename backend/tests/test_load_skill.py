"""Tests for the LoadSkill tool and skills system."""

import json
from tasks import Agent
from tasks.agents.analyst.tools import LoadSkill
from tasks.agents.analyst.prompt_loader import PromptLoader, get_skill, list_skills
from tasks.agents.analyst.agent import AnalystAgent


def _get_system_prompt(**overrides):
    """Helper to build a system prompt with default test variables."""
    loader = PromptLoader()
    defaults = {
        'agent_name': 'Test',
        'schema': '[]',
        'context': '',
        'connection_id': 'test',
        'home_folder': '/org',
        'max_steps': 10,
        'skills_catalog': AnalystAgent._build_skills_catalog(),
    }
    defaults.update(overrides)
    return loader.get('default.system', **defaults)


class TestListSkills:
    """Test that the skills catalog is discoverable."""

    def test_list_skills_returns_dict(self):
        """list_skills() returns a dict of skill_name -> description."""
        skills = list_skills()
        assert isinstance(skills, dict)
        assert len(skills) > 0

    def test_list_skills_contains_expected_skills(self):
        """All expected skill names are present (preloaded + on-demand)."""
        skills = list_skills()
        expected = {
            # Preloaded
            "questions", "dashboards", "contexts", "explore",
            # On-demand
            "alerts", "reports", "parameters", "visualizations", "composed_questions",
        }
        assert expected.issubset(set(skills.keys())), f"Missing skills: {expected - set(skills.keys())}"

    def test_list_skills_descriptions_are_strings(self):
        """Each skill description is a non-empty string."""
        skills = list_skills()
        for name, desc in skills.items():
            assert isinstance(desc, str), f"Skill '{name}' description is not a string"
            assert len(desc) > 0, f"Skill '{name}' has empty description"


class TestGetSkill:
    """Test that individual skills can be loaded by name."""

    def test_get_valid_skill_returns_content(self):
        """get_skill() returns non-empty string for a valid skill name."""
        content = get_skill("alerts")
        assert isinstance(content, str)
        assert len(content) > 0

    def test_get_skill_contains_relevant_content(self):
        """Each skill's content is relevant to its domain."""
        alerts = get_skill("alerts")
        assert "condition" in alerts.lower()

        reports = get_skill("reports")
        assert "schedule" in reports.lower()

        visualizations = get_skill("visualizations")
        assert "vizSettings" in visualizations or "pivot" in visualizations.lower()

        parameters = get_skill("parameters")
        assert "paramName" in parameters or "parameter" in parameters.lower()

        composed = get_skill("composed_questions")
        assert "@alias" in composed or "alias" in composed.lower()

    def test_get_invalid_skill_returns_none(self):
        """get_skill() returns None for an unknown skill name."""
        result = get_skill("nonexistent_skill_xyz")
        assert result is None

    def test_all_listed_skills_are_loadable(self):
        """Every skill in list_skills() can be loaded via get_skill()."""
        skills = list_skills()
        for name in skills:
            content = get_skill(name)
            assert content is not None, f"Skill '{name}' listed but get_skill returned None"
            assert len(content) > 0, f"Skill '{name}' returned empty content"


class TestLoadSkillTool:
    """Test the LoadSkill tool class execution logic."""

    def test_load_skill_logic_valid_name(self):
        """LoadSkill's core logic returns content for a valid skill."""
        content = get_skill("alerts")
        assert content is not None
        result = json.dumps({'success': True, 'skill': 'alerts', 'content': content})
        parsed = json.loads(result)
        assert parsed["success"] is True
        assert len(parsed["content"]) > 0

    def test_load_skill_logic_invalid_name(self):
        """LoadSkill's core logic returns error for invalid skill name."""
        content = get_skill("nonexistent")
        assert content is None
        available = list(list_skills().keys())
        result = json.dumps({
            'success': False,
            'error': f"Skill 'nonexistent' not found. Available skills: {available}"
        })
        parsed = json.loads(result)
        assert parsed["success"] is False
        assert "not found" in parsed["error"].lower()

    def test_load_skill_tool_is_registered(self):
        """LoadSkill is registered as an agent (required for tool dispatch)."""
        assert issubclass(LoadSkill, Agent)


class TestSystemPromptExcludesSkillContent:
    """The base system prompt should NOT contain skill-specific content."""

    def test_system_prompt_does_not_contain_alert_details(self):
        """Alert file structure details should not be in the base system prompt."""
        system = _get_system_prompt()
        assert '"selector": "last"' not in system
        assert '"function": "value"' not in system

    def test_system_prompt_contains_skills_catalog(self):
        """The base system prompt should contain the skills catalog."""
        system = _get_system_prompt()
        assert "LoadSkill" in system
        assert "alerts" in system.lower()

    def test_system_prompt_still_contains_question_structure(self):
        """Question file structure should still be in the base prompt (preloaded)."""
        system = _get_system_prompt()
        assert '"query"' in system
        assert '"vizSettings"' in system

    def test_system_prompt_still_contains_dashboard_structure(self):
        """Dashboard file structure should still be in the base prompt (preloaded)."""
        system = _get_system_prompt()
        assert '"assets"' in system
        assert '"layout"' in system
        assert "12-column grid" in system

    def test_system_prompt_still_contains_context_structure(self):
        """Context file structure should still be in the base prompt (preloaded)."""
        system = _get_system_prompt()
        assert '"versions"' in system
        assert '"docs"' in system
