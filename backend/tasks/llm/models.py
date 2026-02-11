"""LLM request and response models for task orchestration."""

from pydantic import BaseModel, SkipValidation
from typing import List, Optional, Type
from openai.types.chat import ChatCompletionMessageParam, completion_create_params


class ToolCall(BaseModel):
    """Base class for tool calls (for compatibility)."""
    def call(self, *args):
        raise NotImplementedError


class LlmSettings(BaseModel):
    """LLM model configuration settings."""
    model: str
    response_format: completion_create_params.ResponseFormat
    tool_choice: Optional[str] = None
    include_web_search: bool = False

class UserInfo(BaseModel):
    email: Optional[str] = None
    city: Optional[str] = None

class LLMRequest(BaseModel):
    """Base LLM request model."""
    messages: SkipValidation[List[ChatCompletionMessageParam]]
    llmSettings: Optional[LlmSettings] = None
    tools: Optional[List[Type[ToolCall]]] = []
    userInfo: Optional[UserInfo] = None


class ALLMRequest(LLMRequest):
    """Async LLM request model for orchestration (tools are Agent/Tool classes)."""
    tools: Optional[List[Type["Tool"]]] = []  # Forward reference to avoid circular import
