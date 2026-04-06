"""Tests for describe_tool schema generation — ensures Optional fields are not marked required."""

import inspect
from typing import Optional

from pydantic import Field
from pydantic.fields import FieldInfo

from tasks.llm.client import describe_tool
from tasks.orchestrator import Tool


class AllRequiredTool(Tool):
    """Tool where every parameter is required."""

    def __init__(
        self,
        name: str = Field(description="Name of the thing"),
        count: int = Field(description="How many"),
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.name = name
        self.count = count


class AllOptionalTool(Tool):
    """Tool where every parameter is optional."""

    def __init__(
        self,
        file_id: Optional[int] = Field(None, description="File ID"),
        path: Optional[str] = Field(None, description="Path"),
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.file_id = file_id
        self.path = path


class MixedTool(Tool):
    """Tool with a mix of required and optional parameters."""

    def __init__(
        self,
        query: str = Field(description="SQL query to run"),
        connection_id: int = Field(description="Connection to use"),
        limit: Optional[int] = Field(None, description="Row limit"),
        format: Optional[str] = Field(None, description="Output format"),
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.query = query
        self.connection_id = connection_id
        self.limit = limit
        self.format = format


def test_all_required_fields():
    schema = describe_tool(AllRequiredTool)
    required = schema["function"]["parameters"]["required"]
    assert sorted(required) == ["count", "name"]


def test_all_optional_fields():
    schema = describe_tool(AllOptionalTool)
    required = schema["function"]["parameters"]["required"]
    assert required == []


def test_mixed_required_and_optional():
    schema = describe_tool(MixedTool)
    required = schema["function"]["parameters"]["required"]
    assert sorted(required) == ["connection_id", "query"]


def test_optional_fields_still_appear_in_properties():
    """Optional fields should still be in properties, just not in required."""
    schema = describe_tool(AllOptionalTool)
    props = schema["function"]["parameters"]["properties"]
    assert "file_id" in props
    assert "path" in props


def test_optional_fields_have_descriptions():
    schema = describe_tool(AllOptionalTool)
    props = schema["function"]["parameters"]["properties"]
    assert props["file_id"]["description"] == "File ID"
    assert props["path"]["description"] == "Path"


def test_navigate_tool_has_no_required_fields():
    """Regression test: Navigate's file_id/path/newFileType must all be optional."""
    from tasks.agents.analyst.tools import Navigate

    schema = describe_tool(Navigate)
    required = schema["function"]["parameters"]["required"]
    assert required == [], f"Navigate should have no required fields, got: {required}"
