"""
E2E test: image attachment → user message → litellm OpenAI format validation

Covers the exact failure mode where image content blocks were sent in Anthropic
format instead of OpenAI format, causing litellm to raise:
  "Invalid user message at index N. Please ensure all user messages are valid
   OpenAI chat completion messages."

Run with: uv run pytest tests/test_image_attachments.py -v
"""

import pytest
from unittest.mock import MagicMock
from litellm.utils import validate_and_fix_openai_messages
from tasks.agents.analyst.agent import AnalystAgent


def make_agent(attachments: list) -> AnalystAgent:
    """Construct a minimal AnalystAgent with the given attachments."""
    mock_orchestrator = MagicMock()
    mock_orchestrator.get_previous_root_tasks.return_value = []
    mock_orchestrator.onContent = None

    agent = AnalystAgent(
        _unique_id="test",
        orchestrator=mock_orchestrator,
        goal="Describe what you see in the image.",
        attachments=attachments,
        context="",
        schema=[],
    )
    return agent


# ---------------------------------------------------------------------------
# _get_image_content_blocks
# ---------------------------------------------------------------------------

def test_image_content_blocks_use_image_url_format():
    """Content blocks must use OpenAI image_url format, not Anthropic source format."""
    agent = make_agent([
        {"type": "image", "name": "screenshot.png", "content": "https://s3.amazonaws.com/bucket/1/uuid.png", "metadata": {}},
    ])
    blocks = agent._get_image_content_blocks()

    assert len(blocks) == 1
    block = blocks[0]
    assert block["type"] == "image_url", "Must be 'image_url' not 'image' (OpenAI format for litellm)"
    assert "image_url" in block
    assert block["image_url"]["url"] == "https://s3.amazonaws.com/bucket/1/uuid.png"
    assert "source" not in block, "Anthropic 'source' format must not be used — litellm rejects it"


def test_text_attachments_produce_no_image_blocks():
    agent = make_agent([
        {"type": "text", "name": "report.pdf", "content": "some text", "metadata": {"pages": 3}},
    ])
    assert agent._get_image_content_blocks() == []


def test_empty_url_attachment_is_skipped():
    agent = make_agent([{"type": "image", "name": "bad.png", "content": "", "metadata": {}}])
    assert agent._get_image_content_blocks() == []


def test_multiple_images_produce_multiple_blocks():
    agent = make_agent([
        {"type": "image", "name": "a.png", "content": "https://example.com/a.png", "metadata": {}},
        {"type": "image", "name": "b.jpg", "content": "https://example.com/b.jpg", "metadata": {}},
    ])
    blocks = agent._get_image_content_blocks()
    assert len(blocks) == 2
    assert all(b["type"] == "image_url" for b in blocks)


# ---------------------------------------------------------------------------
# _get_user_message → litellm validation (the exact production failure)
# ---------------------------------------------------------------------------

def test_user_message_with_image_passes_litellm_validation():
    """
    Full path: image attachment → _get_user_message() → litellm validator.
    This is the test that would have caught the Anthropic-format bug before prod.
    """
    agent = make_agent([
        {"type": "image", "name": "screenshot.png", "content": "https://s3.amazonaws.com/bucket/1/uuid.png", "metadata": {}},
    ])

    user_msg = agent._get_user_message()

    # Content must be a list (multimodal) when images are present
    assert isinstance(user_msg["content"], list)
    assert user_msg["role"] == "user"

    # The actual litellm validator — this is what crashed in production
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        user_msg,
    ]
    # Must not raise
    validated = validate_and_fix_openai_messages(messages)
    assert validated is not None


def test_user_message_without_images_is_plain_string():
    """No images → content stays a plain string (no unnecessary wrapping)."""
    agent = make_agent([
        {"type": "text", "name": "doc.txt", "content": "some text", "metadata": {}},
    ])
    user_msg = agent._get_user_message()
    assert isinstance(user_msg["content"], str)


def test_user_message_mixed_attachments_passes_litellm_validation():
    """Text + image attachments together must also pass litellm validation."""
    agent = make_agent([
        {"type": "text", "name": "report.pdf", "content": "quarterly numbers", "metadata": {"pages": 5}},
        {"type": "image", "name": "chart.png", "content": "https://s3.amazonaws.com/bucket/1/chart.png", "metadata": {}},
    ])

    user_msg = agent._get_user_message()
    assert isinstance(user_msg["content"], list)

    # Text block first, image block after
    types = [block["type"] for block in user_msg["content"]]
    assert types[0] == "text"
    assert "image_url" in types

    messages = [{"role": "system", "content": "system"}, user_msg]
    validate_and_fix_openai_messages(messages)  # must not raise
