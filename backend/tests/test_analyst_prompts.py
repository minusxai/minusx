"""Test prompt loading and composition."""

import json
import os
import shutil
from pathlib import Path
from tasks.agents.analyst.prompt_loader import PromptLoader
from tasks.agents.analyst.agent import AnalystAgent
from tasks.llm.client import describe_tool


def test_prompt_loader():
    """Test that prompts load and compose correctly.

    Writes composed prompts to test_outputs/ for inspection.
    Set KEEP_TEST_PROMPTS=1 environment variable to skip deletion.
    """
    loader = PromptLoader()

    # Create output directory in tests folder
    test_dir = Path(__file__).parent
    output_dir = test_dir / 'test_outputs' / 'prompts'
    output_dir.mkdir(parents=True, exist_ok=True)

    keep_files = os.getenv('KEEP_TEST_PROMPTS', '0') == '1'

    try:
        system_variables = {
            'agent_name': 'MinusX',
            'schema': '- table: orders\n  columns: [id, customer_id, total, created_at]',
            'context': 'This is a sample e-commerce database.',
            'connection_id': 'test-connection-123',
            'home_folder': '/org',
            'max_steps': 10,
            'skills_catalog': AnalystAgent._build_skills_catalog()
        }
        user_variables = {
            'app_state': '{"fileType": "question", "query": "SELECT * FROM orders"}',
            'goal': 'Show me total revenue by month',
            'current_date': '2026-02-04',
            'attachments': ''
        }

        prompts_to_test = [
            {
                'id': 'default.system',
                'filename': 'system.txt',
                'variables': system_variables,
                'assertions': [
                    ('MinusX', 'Agent name'),
                    ('orders', 'Schema content'),
                    ('e-commerce', 'Context content'),
                    ('test-connection-123', 'Connection ID'),
                    ('/org', 'Home folder'),
                    ('10', 'Max steps'),
                    ('ReadFiles', 'Tool name'),
                    ('EditFile', 'Tool name'),
                    ('SearchDBSchema', 'Tool name'),
                ]
            },
            {
                'id': 'default.user',
                'filename': 'user.txt',
                'variables': user_variables,
                'assertions': [
                    ('fileType', 'App state'),
                    ('Show me total revenue', 'Goal'),
                    ('2026-02-04', 'Current date'),
                ]
            }
        ]

        for test_case in prompts_to_test:
            prompt = loader.get(test_case['id'], **test_case['variables'])

            # Write to file
            file_path = output_dir / test_case['filename']
            with open(file_path, 'w') as f:
                f.write(prompt)

            # Run assertions
            for expected_text, description in test_case['assertions']:
                assert expected_text in prompt, f"Expected '{expected_text}' ({description}) in {test_case['id']}"

            print(f"✓ {test_case['id']} loaded successfully -> {file_path}")

        # Write tool descriptions (use the tool classes directly from imports)
        from tasks.agents.analyst.tools import (
            ReadFiles, EditFile, ExecuteQuery, PublishAll, Navigate,
            Clarify, SearchDBSchema, SearchFiles, CreateFile, LoadSkill
        )
        tools = [ReadFiles, EditFile, ExecuteQuery, PublishAll, Navigate,
                 Clarify, SearchDBSchema, SearchFiles, CreateFile, LoadSkill]
        tool_schemas = [describe_tool(t) for t in tools]
        tools_path = output_dir / 'tools.txt'
        with open(tools_path, 'w') as f:
            f.write(json.dumps(tool_schemas, indent=2))
        print(f"✓ tools written -> {tools_path}")

        print("\n✅ All prompt tests passed!")

        if keep_files:
            print(f"\n📁 Prompt files saved to: {output_dir}")
            print("   (Set KEEP_TEST_PROMPTS=0 to auto-delete)")
        else:
            print(f"\n🗑️  Cleaning up prompt files from: {output_dir}")
            print("   (Set KEEP_TEST_PROMPTS=1 to keep files for inspection)")

    finally:
        # Clean up output directory unless explicitly asked to keep
        if not keep_files:
            shutil.rmtree(output_dir, ignore_errors=True)


if __name__ == '__main__':
    test_prompt_loader()
