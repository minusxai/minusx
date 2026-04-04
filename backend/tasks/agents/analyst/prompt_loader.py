"""Simple prompt loader with template composition and variable substitution."""

import os
import re
import yaml


class PromptLoader:
    """Loads prompts from YAML and resolves template references."""

    def __init__(self, prompts_file: str = None):
        """Initialize prompt loader.

        Args:
            prompts_file: Path to YAML file. Defaults to prompts.yaml in same directory.
        """
        if prompts_file is None:
            current_dir = os.path.dirname(__file__)
            prompts_file = os.path.join(current_dir, "prompts.yaml")

        with open(prompts_file, 'r') as f:
            data = yaml.safe_load(f)

        self.templates = data.get('templates', {})
        self.prompts = data.get('prompts', {})

    def get(self, prompt_id: str, **variables) -> str:
        """Get prompt by ID with variable substitution.

        Args:
            prompt_id: Prompt identifier (e.g., 'system', 'user')
            **variables: Variables to substitute in the prompt

        Returns:
            Fully composed and substituted prompt string

        Example:
            >>> loader = PromptLoader()
            >>> prompt = loader.get(
            ...     'system',
            ...     schema='...',
            ...     context='...',
            ...     connection_id='123',
            ...     max_steps=10
            ... )
        """
        # Get the prompt template
        prompt = self._get_nested(self.prompts, prompt_id)
        if prompt is None:
            raise ValueError(f"Prompt '{prompt_id}' not found")

        # Resolve template references ({template_name} or {template.path})
        prompt = self._resolve_templates(prompt)

        # Substitute variables
        prompt = prompt.format(**variables)

        return prompt

    def _get_nested(self, data: dict, path: str):
        """Get nested value from dict using dot notation path.

        Args:
            data: Dictionary to search
            path: Dot-separated path (e.g., 'system.question', 'context.schema')

        Returns:
            Value at path or None if not found
        """
        keys = path.split('.')
        current = data

        for key in keys:
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                return None

        return current

    def list_skills(self) -> dict:
        """Return a dict of skill_name -> description for all available skills.

        Skills are templates whose keys start with 'skill_'.
        """
        skills = {}
        for key, value in self.templates.items():
            if key.startswith('skill_') and isinstance(value, dict):
                name = key[len('skill_'):]  # strip 'skill_' prefix
                skills[name] = value.get('description', '')
        return skills

    def get_skill(self, name: str) -> str | None:
        """Get the resolved content of a skill by name.

        Args:
            name: Skill name (e.g., 'alerts', 'reports'). The 'skill_' prefix is added automatically.

        Returns:
            Resolved skill content string, or None if not found.
        """
        key = f'skill_{name}'
        template = self.templates.get(key)
        if template is None or not isinstance(template, dict):
            return None
        content = template.get('content', '')
        if not content:
            return None
        # Resolve any nested template references within the skill content
        return self._resolve_templates(content)

    def _resolve_templates(self, text: str) -> str:
        """Resolve template references in text.

        Handles:
        - {path.to.template} style nested references (with dots)
        - {template_name} style simple references (single word, if exists in templates)

        Args:
            text: Text containing template references

        Returns:
            Text with all template references resolved
        """
        # Pattern to match {path.to.template} (nested with dots)
        nested_pattern = re.compile(r'\{([\w]+\.[\w.]+)\}')

        # Pattern to match simple {template_name} (single word)
        simple_pattern = re.compile(r'\{(\w+)\}')

        # Keep resolving until no more references found (handles nested templates)
        max_iterations = 10  # Prevent infinite loops
        for _ in range(max_iterations):
            made_replacement = False

            # Resolve {path.to.template} style
            for template_path in nested_pattern.findall(text):
                template_content = self._get_nested(self.templates, template_path)
                if template_content is None:
                    raise ValueError(f"Template '{template_path}' not found")
                text = text.replace(f'{{{template_path}}}', template_content)
                made_replacement = True

            # Resolve simple {template_name} style (only if template exists)
            for template_name in simple_pattern.findall(text):
                if template_name in self.templates:
                    template_content = self.templates[template_name]
                    if isinstance(template_content, str):
                        text = text.replace(f'{{{template_name}}}', template_content)
                        made_replacement = True

            if not made_replacement:
                break

        return text


# Global instance for easy import
_loader = None


def _get_loader() -> PromptLoader:
    """Get or create the global PromptLoader singleton."""
    global _loader
    if _loader is None:
        _loader = PromptLoader()
    return _loader


def get_prompt(prompt_id: str, **variables) -> str:
    """Convenience function to get a prompt using global loader.

    Args:
        prompt_id: Prompt identifier
        **variables: Variables to substitute

    Returns:
        Composed and substituted prompt
    """
    return _get_loader().get(prompt_id, **variables)


def list_skills() -> dict:
    """List all available skills with their descriptions."""
    return _get_loader().list_skills()


def get_skill(name: str) -> str | None:
    """Get a skill's resolved content by name. Returns None if not found."""
    return _get_loader().get_skill(name)
