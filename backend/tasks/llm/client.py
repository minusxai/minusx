"""LLM API client functions for task orchestration."""

import inspect
import json
import logging
import os
import time
import uuid
from enum import Enum
from typing import List, get_args, get_origin, Union

from litellm import acompletion
from litellm.llms.custom_httpx.http_handler import AsyncHTTPHandler
import litellm
import httpx
from pydantic.fields import FieldInfo

from .models import ALLMRequest, LlmSettings
from .config import DEFAULT_MODEL, MAX_TOKENS, DEBUG_DURATION, MX_API_BASE_URL, MX_API_KEY, HTTP_MAX_CONNECTIONS, HTTP_KEEPALIVE_EXPIRY, HTTP_TIMEOUT
from .transport import MxProxyTransport
from ..debug_context import LLMDebug, get_task_debug

# Configure litellm
is_litellm_log = os.environ.get('LITELLM_LOG', "").lower() == 'debug'
if is_litellm_log:
    litellm.set_verbose = True

litellm.include_cost_in_streaming_usage = True


_custom_session = None


def _get_or_create_session():
    """Get or create the custom httpx session with connection pooling."""
    global _custom_session
    if _custom_session is None:
        if MX_API_BASE_URL:
            transport = MxProxyTransport(proxy_url=MX_API_BASE_URL, mx_api_key=MX_API_KEY)
            _custom_session = httpx.AsyncClient(
                transport=transport,
                timeout=httpx.Timeout(HTTP_TIMEOUT),
            )
            # OpenAI: aclient_session → AsyncOpenAI(http_client=...)
            litellm.aclient_session = _custom_session
            # Anthropic streaming: make_call() falls back to module_level_aclient
            _mx_handler = AsyncHTTPHandler(timeout=httpx.Timeout(HTTP_TIMEOUT))
            _mx_handler.client = _custom_session  # inject our transport-backed client
            litellm.module_level_aclient = _mx_handler
        else:
            # Direct mode: standard connection-pooled client
            limits = httpx.Limits(
                max_keepalive_connections=HTTP_MAX_CONNECTIONS,
                max_connections=HTTP_MAX_CONNECTIONS,
                keepalive_expiry=HTTP_KEEPALIVE_EXPIRY,
            )
            _custom_session = httpx.AsyncClient(limits=limits, timeout=httpx.Timeout(HTTP_TIMEOUT))
            litellm.aclient_session = _custom_session
        if DEBUG_DURATION:
            print(f"TIMING: Created httpx session with {HTTP_MAX_CONNECTIONS} max connections")
    return _custom_session


logger = logging.getLogger("agents")
logger.setLevel(logging.INFO)


TYPE_MAP = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
    list: "array",
    dict: "object"
}


def get_json_schema_type(annotation):
    """Convert Python type annotation to JSON schema type."""
    origin = get_origin(annotation)
    args = get_args(annotation)

    if annotation == str:
        return {"type": "string"}
    elif annotation == int:
        return {"type": "integer"}
    elif annotation == float:
        return {"type": "number"}
    elif annotation == bool:
        return {"type": "boolean"}
    elif origin == list or origin == List:
        item_type = get_json_schema_type(args[0]) if args else {"type": "string"}
        return {"type": "array", "items": item_type}
    elif origin == Union:
        # Handle Optional[T] by extracting the non-None type
        non_none_args = [arg for arg in args if arg is not type(None)]
        if len(non_none_args) == 1:
            # This is Optional[T], recurse on T
            return get_json_schema_type(non_none_args[0])
        # For complex unions, fall through to default
    elif annotation == dict:
        return {"type": "object"}
    elif isinstance(annotation, type) and issubclass(annotation, Enum):
        return {
            "type": "string",
            "enum": [item.value for item in annotation]
        }
    elif hasattr(annotation, 'model_json_schema'):
        # Handle pydantic models
        return annotation.model_json_schema()
    return {"type": "string"}  # fallback


def describe_tool(cls):
    """
    Convert a Tool/Agent class into OpenAI function schema format.

    Args:
        cls: Agent or Tool class to convert

    Returns:
        Dict with OpenAI function tool schema
    """
    sig = inspect.signature(cls.__init__)
    properties = {}
    required = []

    for name, param in sig.parameters.items():
        if name == "self" or name.startswith("_") or param.kind not in (
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.KEYWORD_ONLY,
        ):
            continue

        annotation = param.annotation
        default = param.default
        schema = get_json_schema_type(annotation)
        required.append(name)

        if isinstance(default, FieldInfo):
            if default.description:
                schema["description"] = default.description

        properties[name] = schema

    return {
        "type": "function",
        "function": {
            "name": cls.__name__,
            "description": (cls.__doc__ or "").strip(),
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required
            }
        }
    }


def generate_unique_tool_call_id():
    """Generate a unique tool call ID for tracking."""
    return f"call_{uuid.uuid4().hex[:24]}"


async def allm_request(request: ALLMRequest, on_content=None):
    """
    Make an async LLM request with streaming support.

    Args:
        request: ALLMRequest containing messages, model settings, and tools
        on_content: Optional callback for streaming content chunks (receives content, stream_id)

    Returns:
        Tuple of (response dict, usage dict) where:
            - response contains: content, role, tool_calls, stream_id, finish_reason
            - usage contains: token counts, cost, etc.
    """
    # Set default settings if not provided
    if request.llmSettings is None:
        request.llmSettings = LlmSettings(
            model=DEFAULT_MODEL,
            response_format={"type": "text"},
            tool_choice="required"
        )

    # Add default tools if none provided and tool_choice requires them
    if (request.tools is None or len(request.tools) == 0) and \
       request.llmSettings.tool_choice is not None and \
       request.llmSettings.tool_choice != 'auto':
        # Note: MarkTaskDone and TalkToUser would be imported from tools if needed
        # For now, we'll just use the provided tools
        request.tools = []

    # Convert tools to OpenAI function format
    tool_descriptions = [describe_tool(tool) for tool in request.tools] if request.tools else []

    completion_request = {
        "model": request.llmSettings.model,
        "messages": request.messages,
        "response_format": request.llmSettings.response_format,
        "tool_choice": request.llmSettings.tool_choice,
        "tools": tool_descriptions,
        # litellm settings
        "drop_params": True,
        "user": request.userInfo.email if request.userInfo else None,
        "stream": True,  # Enable streaming
        "stream_options": {"include_usage": True},  # Ensure usage is included in stream
    }

    # Model-specific configuration
    if completion_request["model"] in ["o1", "o4-mini"]:
        completion_request["temperature"] = 1
        completion_request["max_tokens"] = MAX_TOKENS

    elif "gpt-5" in completion_request["model"]:
        completion_request["max_completion_tokens"] = MAX_TOKENS * 3
        completion_request["reasoning_effort"] = "high"
        completion_request["verbosity"] = "high"

    elif 'claude' in completion_request["model"]:
        completion_request["max_completion_tokens"] = MAX_TOKENS * 2
        completion_request["temperature"] = 0
        completion_request["tool_choice"] = "auto"

        # Add cache checkpoint for the first message
        msgs = request.messages
        if isinstance(msgs[0].get('content'), dict):
            msgs[0]['content']["cache_control"] = {"type": "ephemeral"}
        elif isinstance(msgs[0].get('content'), list):
            msgs[0]['content'][-1]["cache_control"] = {"type": "ephemeral"}
        elif isinstance(msgs[0].get('content'), str):
            msgs[0]['content'] = [{
                "type": "text",
                "text": msgs[0]['content'],
                "cache_control": {"type": "ephemeral"}
            }]
        completion_request["messages"] = msgs

        if len(tool_descriptions) > 0:
            tool_descriptions[-1]['function']['cache_control'] = {"type": "ephemeral"}
        completion_request["tools"] = tool_descriptions

        # Add web search options if enabled
        if request.llmSettings.include_web_search:
            web_search_options = {
                "search_context_size": "medium"
            }
            if request.userInfo and request.userInfo.city:
                web_search_options["user_location"] = {
                    "type": "approximate",
                    "approximate": {
                        "city": request.userInfo.city
                    }
                }
            completion_request["web_search_options"] = web_search_options

    else:
        completion_request["max_completion_tokens"] = MAX_TOKENS
        completion_request["temperature"] = 0

    # When proxying through mx-llm-provider, generate the call UUID here and pass
    # it as a request header so the provider stores exactly this UUID as call_uuid.
    # This avoids unreliable ContextVar propagation from the transport layer back
    # to this calling code (ContextVar.set() inside handle_async_request doesn't
    # propagate back due to asyncio context-copy semantics).
    mx_request_call_id: str | None = None
    if MX_API_BASE_URL:
        mx_request_call_id = str(uuid.uuid4())
        completion_request["extra_headers"] = {"X-MX-Request-Call-ID": mx_request_call_id}

    # Ensure custom session is created for connection pooling
    session_start = time.perf_counter()
    session = _get_or_create_session()
    session_duration = time.perf_counter() - session_start

    # Monitor connection pool usage (simplified to avoid errors)
    try:
        pool_info = session._transport._pool
        total_connections = len(pool_info._connections)
        if DEBUG_DURATION:
            print(f"TIMING: httpx session setup: {session_duration:.3f}s, pool: {total_connections} total connections")
    except Exception as e:
        if DEBUG_DURATION:
            print(f"TIMING: httpx session setup: {session_duration:.3f}s, pool monitoring error: {e}")

    # Time the full LiteLLM request with streaming
    litellm_start = time.perf_counter()
    stream_response = await acompletion(**completion_request)

    # Generate unique stream ID for tracking this specific LLM call
    stream_id = generate_unique_tool_call_id()

    # Accumulate streaming response
    accumulated_content = ""
    accumulated_tool_calls = []  # List to hold tool calls by index
    usage = None
    finish_reason = None
    cost = 0.0  # Default to 0.0 if not provided in stream
    litellm_overhead_time_ms = 0.0
    litellm_call_id = None
    citations = []
    web_search_results = []  # NEW: Collect web search results

    async for chunk in stream_response:
        # Get delta from first choice
        if hasattr(chunk, 'choices') and len(chunk.choices) > 0:
            delta = chunk.choices[0].delta

            # Accumulate and stream content
            if hasattr(delta, 'content') and delta.content:
                accumulated_content += delta.content

                # Stream content to callback if provided (with stream ID for tracking)
                if on_content:
                    on_content(delta.content, stream_id)

            # Accumulate tool calls (incremental building)
            if hasattr(delta, 'tool_calls') and delta.tool_calls:
                for tool_call_delta in delta.tool_calls:
                    index = tool_call_delta.index

                    # Ensure we have a slot for this tool call index
                    while len(accumulated_tool_calls) <= index:
                        accumulated_tool_calls.append({
                            "id": None,
                            "type": "function",
                            "function": {
                                "name": None,
                                "arguments": ""
                            }
                        })

                    # Update tool call at this index
                    if hasattr(tool_call_delta, 'id') and tool_call_delta.id:
                        accumulated_tool_calls[index]["id"] = tool_call_delta.id

                    if hasattr(tool_call_delta, 'function') and tool_call_delta.function:
                        if hasattr(tool_call_delta.function, 'name') and tool_call_delta.function.name:
                            accumulated_tool_calls[index]["function"]["name"] = tool_call_delta.function.name
                        if hasattr(tool_call_delta.function, 'arguments') and tool_call_delta.function.arguments:
                            accumulated_tool_calls[index]["function"]["arguments"] += tool_call_delta.function.arguments

            # Get finish reason
            if hasattr(chunk.choices[0], 'finish_reason') and chunk.choices[0].finish_reason:
                finish_reason = chunk.choices[0].finish_reason

            # Collect provider-specific fields (citations and web search results)
            if hasattr(delta, 'provider_specific_fields') and delta.provider_specific_fields:
                if 'citation' in delta.provider_specific_fields:
                    citations.append(delta.provider_specific_fields['citation'])
                if 'web_search_results' in delta.provider_specific_fields:
                    # web_search_results is an array of result blocks
                    web_search_results.extend(delta.provider_specific_fields['web_search_results'])


        # Get usage from chunk (usually in last chunk)
        if hasattr(chunk, 'usage') and chunk.usage:
            usage = chunk.usage

        # Get cost and metadata from hidden params
        if hasattr(chunk, '_hidden_params'):
            if 'response_cost' in chunk._hidden_params and chunk._hidden_params['response_cost'] is not None:
                cost = chunk._hidden_params['response_cost']
            if 'litellm_overhead_time_ms' in chunk._hidden_params and chunk._hidden_params['litellm_overhead_time_ms'] is not None:
                litellm_overhead_time_ms = chunk._hidden_params['litellm_overhead_time_ms']
            if 'litellm_call_id' in chunk._hidden_params and chunk._hidden_params['litellm_call_id'] is not None:
                litellm_call_id = chunk._hidden_params['litellm_call_id']

    litellm_duration = time.perf_counter() - litellm_start
    if DEBUG_DURATION:
        print(f"TIMING: LiteLLM streaming total: {litellm_duration:.3f}s")

    duration = litellm_duration

    # Build content blocks array from accumulated data
    content_blocks = []

    # Add text content as a block if present
    if accumulated_content:
        content_blocks.append({
            "type": "text",
            "text": accumulated_content
        })

    # Add web_search_tool_result blocks (keep original structure for Anthropic)
    if web_search_results:
        content_blocks.extend(web_search_results)

    # Filter out server-side tool calls (web_search, etc.) - these are in content blocks only
    # Server-side tools have IDs like "srvtoolu_xxx" instead of "call_xxx"
    client_tool_calls = [
        tc for tc in accumulated_tool_calls
        if tc.get("id") and not tc["id"].startswith("srvtoolu_")
    ]

    # Build final response object
    response = {
        "content": accumulated_content,  # Keep for backward compatibility
        "content_blocks": content_blocks,  # NEW: Structured content blocks
        "role": "assistant",
        "tool_calls": client_tool_calls,  # Only client-side tools
        "stream_id": stream_id,
        "finish_reason": finish_reason,
        "citations": citations,  # Keep for backward compatibility
        "web_search_results": web_search_results  # Keep raw data
    }

    # Convert usage to dict if it's an object
    if usage and hasattr(usage, 'model_dump'):
        usage = usage.model_dump()
    elif usage and hasattr(usage, 'to_dict'):
        usage = usage.to_dict()

    # Use the client-generated UUID when proxying through mx-llm-provider.
    # The provider was sent this UUID via X-MX-Request-Call-ID and stores it
    # as call_uuid, so lllm_call_id and call_uuid are guaranteed to match.
    # Falls back to LiteLLM's own internal UUID for direct (non-proxy) calls.
    if mx_request_call_id:
        litellm_call_id = mx_request_call_id

    if not usage:
        # Fallback if usage not provided
        usage = {
            "total_tokens": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "completion_tokens_details": {},
            "prompt_tokens_details": {}
        }

    # Ensure required fields exist with defaults
    usage.setdefault('total_tokens', 0)
    usage.setdefault('prompt_tokens', 0)
    usage.setdefault('completion_tokens', 0)
    usage.setdefault('completion_tokens_details', {})
    usage.setdefault('prompt_tokens_details', {})

    if DEBUG_DURATION:
        print(f"TIMING: Stream processing complete, tokens: {usage.get('total_tokens', 0)}")

    # Ensure cost is never None (fallback to 0)
    if cost is None:
        cost = 0.0

    # Track LLM call in task debug context
    task_debug = get_task_debug()
    if 'cost' not in usage:
        usage['cost'] = cost
    task_debug.llmDebug.append(LLMDebug(
        model=completion_request["model"],
        finish_reason=finish_reason,
        duration=duration,
        total_tokens=usage['total_tokens'],
        prompt_tokens=usage['prompt_tokens'],
        completion_tokens=usage['completion_tokens'],
        cost=usage['cost'],
        completion_tokens_details=usage['completion_tokens_details'],
        prompt_tokens_details=usage['prompt_tokens_details'],
        lllm_call_id=litellm_call_id,
        lllm_overhead_time_ms=litellm_overhead_time_ms,
    ))

    return response, usage
