"""Tests for the LoadSkill tool and skills system."""

import json
from tasks import Agent
from tasks.agents.analyst.tools import LoadSkill
from tasks.agents.analyst.prompt_loader import PromptLoader, get_skill, list_skills
from tasks.agents.analyst.agent import AnalystAgent, DEFAULT_PRELOADED_SKILLS


def _get_system_prompt(preloaded_skill_names=None, **overrides):
    """Helper to build a system prompt with default test variables."""
    loader = PromptLoader()
    if preloaded_skill_names is None:
        preloaded_skill_names = DEFAULT_PRELOADED_SKILLS
    preloaded_set = set(preloaded_skill_names)
    defaults = {
        'agent_name': 'Test',
        'schema': '[]',
        'context': '',
        'connection_id': 'test',
        'home_folder': '/org',
        'max_steps': 10,
        'allowed_viz_types': 'all',
        'skills_catalog': AnalystAgent._build_skills_catalog(preloaded_set),
        'preloaded_skills': AnalystAgent._build_preloaded_skills_content(preloaded_skill_names),
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

    def test_question_page_preloads_question_skill(self):
        """On a question page, question skill content is preloaded."""
        system = _get_system_prompt(preloaded_skill_names=["questions"])
        assert '"query"' in system
        assert '"vizSettings"' in system
        # Dashboard skill should NOT be preloaded (check for dashboard-specific content)
        assert "Dashboard Page Behavior" not in system

    def test_dashboard_page_preloads_dashboard_and_question_skills(self):
        """On a dashboard page, both dashboard and question skills are preloaded."""
        system = _get_system_prompt(preloaded_skill_names=["dashboards", "questions"])
        assert '"assets"' in system
        assert '"layout"' in system
        assert "12-column grid" in system
        assert '"query"' in system

    def test_context_page_preloads_context_skill(self):
        """On a context page, context skill content is preloaded."""
        system = _get_system_prompt(preloaded_skill_names=["contexts"])
        assert '"versions"' in system
        assert '"docs"' in system

    def test_alert_page_preloads_alert_skill(self):
        """On an alert page, alert skill is preloaded (not on-demand)."""
        system = _get_system_prompt(preloaded_skill_names=["alerts"])
        assert '"selector": "last"' in system
        assert '"function": "value"' in system

    def test_preloaded_skills_excluded_from_catalog(self):
        """Skills that are preloaded should not appear in the LoadSkill catalog."""
        system = _get_system_prompt(preloaded_skill_names=["dashboards", "questions"])
        # "dashboards" and "questions" should NOT be in the catalog
        assert '"dashboards"' not in system
        assert '"questions"' not in system
        # But "alerts" should be in the catalog
        assert '"alerts"' in system
