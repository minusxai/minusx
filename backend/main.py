from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ConfigDict
import os
import uuid
import json
import asyncio
import logging
import traceback
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List, Callable
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables from .env file
load_dotenv()

from sql_utils.validator import validate_sql as validate_sql_syntax  # noqa: E402
from sql_utils.column_inferrer import infer_columns  # noqa: E402
from sql_utils.autocomplete import get_completions, AutocompleteRequest, get_mention_completions  # noqa: E402
from sql_utils.table_validator import validate_query_tables  # noqa: E402
from sql_ir import parse_sql_to_ir, any_ir_to_sql, UnsupportedSQLError  # noqa: E402

# Import orchestration components
from tasks import Orchestrator, AgentCall, UserInputException  # noqa: E402
from tasks.orchestrator import ConversationLog  # noqa: E402
from tasks.conversation import get_latest_root, update_log_with_completed_tool_calls, get_pending_tool_calls, get_completed_tool_calls  # noqa: E402
from tasks.types import ChatCompletionToolMessageParamMX, ChatCompletionMessageToolCallParamMX, CompletedToolCallsMXWithRunId  # noqa: E402
from internal_notifier import notify_internal  # noqa: E402
import litellm  # noqa: E402
from tasks.agents.analyst.prompt_loader import PromptLoader, get_skill  # noqa: E402
from tasks.agents.analyst.file_schema import ATLAS_FILE_SCHEMA_JSON, vizSettingsJsonStr  # noqa: E402
from tasks.llm.client import describe_tool  # noqa: E402
import tasks.agents.analyst.agent  # noqa: E402, F401
import tasks.agents.analyst.tools  # noqa: E402, F401

app = FastAPI(title="MinusX BI Backend")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Next.js frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> None:
    await notify_internal(
        'backend',
        str(exc),
        {'traceback': traceback.format_exc()[-500:], 'path': str(request.url.path)},
    )
    raise exc


@app.on_event("startup")
async def startup_event():
    print("[Backend] Python backend ready.")


@app.get("/")
async def root():
    return {"message": "MinusX BI Backend API", "status": "running"}




@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.post("/api/sql-autocomplete")
async def sql_autocomplete(request: AutocompleteRequest):
    """SQL autocomplete suggestions endpoint"""
    try:
        suggestions = get_completions(
            request.query,
            request.cursor_offset,
            request.schema_data,
            request.connection_name,
            request.connection_type,
        )
        return {"suggestions": [s.dict() for s in suggestions]}
    except Exception as e:
        logger.error(f"Autocomplete error: {e}")
        traceback.print_exc()
        return {"suggestions": []}


class ValidateSqlRequest(BaseModel):
    """Request to validate SQL syntax"""
    query: str
    dialect: str


@app.post("/api/validate-sql")
async def validate_sql(request: ValidateSqlRequest):
    """Validate SQL syntax using sqlglot and return error positions."""
    try:
        result = validate_sql_syntax(request.query, request.dialect)
        return {"valid": result.valid, "errors": [e.__dict__ for e in result.errors]}
    except Exception as e:
        logger.error(f"SQL validation error: {e}")
        return {"valid": True, "errors": []}


class ValidateQueryTablesRequest(BaseModel):
    """Request to validate that a SQL query only references whitelisted tables."""
    sql: str
    whitelist: List[Dict[str, Any]]
    session_token: Optional[str] = None  # injected by pythonBackendFetch, not used here


@app.post("/api/validate-query-tables")
async def validate_query_tables_endpoint(request: ValidateQueryTablesRequest):
    """Validate that every table referenced in a SQL query is covered by the provided whitelist.

    Returns {"error": null} when the query is allowed, or {"error": "<message>"} when blocked.
    Unparseable SQL is allowed through — the execution layer surfaces syntax errors.

    The frontend sends tables as [{table: 'name'}] objects; normalise to the flat
    ['name'] strings that validate_query_tables expects.
    """
    normalised = [
        {
            "schema": entry.get("schema", ""),
            "tables": [
                t["table"] if isinstance(t, dict) else t
                for t in (entry.get("tables") or [])
            ],
        }
        for entry in request.whitelist
    ]
    error = validate_query_tables(request.sql, normalised)
    return {"error": error}


class InferColumnsRequest(BaseModel):
    """Request to infer output columns from a SQL query"""
    query: str
    schema_data: List[Dict[str, Any]] = []
    dialect: str


@app.post("/api/infer-columns")
async def infer_columns_endpoint(request: InferColumnsRequest):
    """Infer output column names and types from a SQL query using sqlglot static analysis."""
    result = infer_columns(request.query, request.schema_data, request.dialect)
    return {
        "columns": [{"name": c.name, "type": c.type} for c in result.columns],
        "error": result.error,
    }


class MentionRequest(BaseModel):
    """Request for chat mention suggestions"""
    prefix: str
    schema_data: List[Dict[str, Any]] = []
    available_questions: List[Dict[str, Any]] = []
    mention_type: str = "all"  # "all" or "questions"


@app.post("/api/chat-mentions")
async def chat_mentions(request: MentionRequest):
    """Chat mention suggestions endpoint (@ for tables+questions, @@ for questions only)"""
    try:
        suggestions = get_mention_completions(
            request.prefix,
            request.schema_data,
            request.available_questions,
            request.mention_type
        )
        return {"suggestions": [s.dict() for s in suggestions]}
    except Exception as e:
        logger.error(f"Mention error: {e}")
        traceback.print_exc()
        return {"suggestions": []}


class SqlToIRRequest(BaseModel):
    sql: str
    dialect: str
    connection_name: Optional[str] = None


class SqlToIRResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    success: bool
    ir: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    unsupported_features: Optional[List[str]] = Field(None, alias="unsupportedFeatures")
    hint: Optional[str] = None
    warnings: Optional[List[str]] = None


@app.post("/api/sql-to-ir", response_model=SqlToIRResponse)
async def sql_to_ir_endpoint(req: SqlToIRRequest):
    """
    Parse SQL query into Intermediate Representation (IR) for GUI builder.

    Returns IR if SQL uses only supported features, otherwise returns error with
    list of unsupported features.
    """
    try:
        ir = parse_sql_to_ir(req.sql, req.dialect)
        return SqlToIRResponse(
            success=True,
            ir=ir.model_dump(by_alias=True),
            warnings=None,  # Future: add warnings for removed comments, etc.
        )
    except UnsupportedSQLError as e:
        # Use hint from enhanced validator (prioritize), or fall back to legacy hints
        hint = e.hint
        if not hint and e.features:
            # Legacy hints for backward compatibility
            legacy_hints = {
                "SUBQUERY": "Try using JOINs instead of subqueries",
                "CTE": "Common Table Expressions (WITH) are not supported in GUI mode",
                "UNION": "UNION queries could not be parsed for GUI mode",
                "WINDOW_FUNCTION": "Window functions (OVER) are not supported in GUI mode",
                "CASE": "CASE expressions are not supported in GUI mode",
            }
            hint = legacy_hints.get(e.features[0])

        return SqlToIRResponse(
            success=False,
            error=str(e),
            unsupported_features=e.features,
            hint=hint,
        )
    except Exception as e:
        logger.error(f"[sql_to_ir] Unexpected error: {e}")
        logger.error(traceback.format_exc())
        return SqlToIRResponse(
            success=False,
            error=f"Failed to parse SQL: {str(e)}",
            unsupported_features=["PARSE_ERROR"],
        )


class IRToSqlRequest(BaseModel):
    ir: Dict[str, Any]
    dialect: str


class IRToSqlResponse(BaseModel):
    success: bool
    sql: Optional[str] = None
    error: Optional[str] = None


@app.post("/api/ir-to-sql", response_model=IRToSqlResponse)
async def ir_to_sql_endpoint(req: IRToSqlRequest):
    """
    Convert Intermediate Representation (IR) back to SQL string.

    This is the single source of truth for IR→SQL conversion,
    used by both backend validation and frontend GUI builder.
    """
    try:
        # Dispatch based on IR type
        sql = any_ir_to_sql(req.ir, req.dialect)

        return IRToSqlResponse(
            success=True,
            sql=sql,
        )
    except Exception as e:
        logger.error(f"[ir_to_sql] Error: {e}")
        logger.error(traceback.format_exc())
        return IRToSqlResponse(
            success=False,
            error=f"Failed to generate SQL: {str(e)}",
        )


# ============================================================================
# Orchestration API - Simplified Chat Planner
# ============================================================================

async def process_conversation(
    request: 'ConversationRequest',
    on_content: Optional[Callable[[str, str], None]] = None,
    on_tool_created: Optional[Callable] = None,
    on_tool_completed: Optional[Callable] = None
) -> 'ConversationResponse':
    """
    Core conversation processing logic used by both streaming and non-streaming endpoints.

    Handles:
    1. Request setup (parse log, check for pending tools)
    2. Early return if there are pending tool calls
    3. Orchestrator execution with optional callbacks for streaming
    4. Final response building with log diff and tool calls

    Args:
        request: ConversationRequest with log, user message, agent info
        on_content: Optional callback for LLM content streaming (for SSE)
        on_tool_created: Optional callback when tools are created (for SSE)
        on_tool_completed: Optional callback when tools complete (for SSE)

    Returns:
        ConversationResponse with logDiff, pending/completed tools, llm_calls
    """
    is_start = request.user_message is not None
    init_log_length = len(request.log)

    # Setup: Parse request and check for pending tools
    _, latest_root = get_latest_root(request.log)
    latest_root_id = latest_root.unique_id if latest_root else None
    updated_log, pending_tool_calls = update_log_with_completed_tool_calls(
        request.log,
        request.completed_tool_calls,
        interrupt_pending=is_start
    )

    # Early return if there are pending tool calls (no orchestrator needed)
    if pending_tool_calls:
        log_diff = updated_log[init_log_length:]
        completed_tool_calls = get_completed_tool_calls(updated_log, init_log_length)
        llm_calls = extract_llm_calls_from_log_diff(log_diff)

        return ConversationResponse(
            logDiff=log_diff,
            pending_tool_calls=pending_tool_calls,
            completed_tool_calls=completed_tool_calls,
            llm_calls=llm_calls,
            error=None
        )

    # Create orchestrator with optional callbacks for streaming
    orchestrator = Orchestrator(
        log=updated_log if updated_log else None,
        onContent=on_content,
        onToolCreated=on_tool_created,
        onToolCompleted=on_tool_completed
    )

    # Run orchestrator (execute or resume)
    try:
        if is_start:
            agent_args = request.agent_args.copy()
            agent_args['goal'] = request.user_message
            await orchestrator.run(
                AgentCall(agent=request.agent, args=agent_args),
                previous_unique_id=latest_root_id
            )
        else:
            await orchestrator.resume()
    except UserInputException:
        pass

    # Build final response
    log_diff = orchestrator.compressed.log[init_log_length:]
    pending_tool_calls = get_pending_tool_calls(orchestrator.compressed.log)
    completed_tool_calls = get_completed_tool_calls(orchestrator.compressed.log, init_log_length)
    llm_calls = extract_llm_calls_from_log_diff(log_diff)

    return ConversationResponse(
        logDiff=log_diff,
        pending_tool_calls=pending_tool_calls,
        completed_tool_calls=completed_tool_calls,
        llm_calls=llm_calls,
        error=None
    )


class ConversationRequest(BaseModel):
    """Request for conversation API with append-only model."""
    log: ConversationLog = Field(default_factory=list)
    user_message: Optional[str] = None
    completed_tool_calls: List[ChatCompletionToolMessageParamMX] = Field(default_factory=list)
    agent: str
    agent_args: Dict[str, Any]
    session_token: Optional[str] = None  # Session token for internal API auth


class LLMCallDetail(BaseModel):
    """Detailed LLM call information extracted from debug logs."""
    llm_call_id: str
    model: str
    duration: float
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    cost: float
    finish_reason: Optional[str] = None
    trigger: Optional[str] = None  # What initiated this LLM call: "user_message", "tool_result", etc.


class ConversationResponse(BaseModel):
    """Response with only new conversation entries (diff)."""
    logDiff: ConversationLog
    pending_tool_calls: List[ChatCompletionMessageToolCallParamMX] = Field(default_factory=list)
    completed_tool_calls: CompletedToolCallsMXWithRunId = Field(default_factory=list)
    llm_calls: Dict[str, LLMCallDetail] = Field(default_factory=dict)  # NEW
    error: Optional[str] = None


class CloseConversationRequest(BaseModel):
    """Request to close a conversation and mark pending tools as interrupted."""
    log: ConversationLog


class CloseConversationResponse(BaseModel):
    """Response with log entries marking pending tools as interrupted."""
    logDiff: ConversationLog


def extract_llm_calls_from_log_diff(log_diff: ConversationLog) -> Dict[str, LLMCallDetail]:
    """
    Extract LLM call details from logDiff entries.

    Args:
        log_diff: List of conversation log entries

    Returns:
        Dictionary mapping llm_call_id to detailed call information
    """
    from tasks.orchestrator import TaskDebugLog  # noqa: PLC0415

    llm_calls: Dict[str, LLMCallDetail] = {}

    for entry in log_diff:
        if not isinstance(entry, TaskDebugLog):
            continue

        for llm_debug in entry.llmDebug:
            call_id = llm_debug.lllm_call_id
            if call_id and call_id not in llm_calls:
                llm_calls[call_id] = LLMCallDetail(
                    llm_call_id=call_id,
                    model=llm_debug.model,
                    duration=llm_debug.duration,
                    total_tokens=llm_debug.total_tokens,
                    prompt_tokens=llm_debug.prompt_tokens,
                    completion_tokens=llm_debug.completion_tokens,
                    cost=llm_debug.cost,
                    finish_reason=llm_debug.finish_reason,
                    trigger=llm_debug.trigger,
                )

    return llm_calls


@app.get("/api/tools/schema")
async def get_tool_schemas():
    """Return OpenAI function schemas for all registered tools (dev tool tester)."""
    from tasks.llm.client import describe_tool  # noqa: PLC0415
    schemas = []
    for _name, agent_cls in Orchestrator._agent_registry.items():
        try:
            schemas.append(describe_tool(agent_cls))
        except Exception:
            pass
    return schemas


@app.post("/api/chat/close", response_model=CloseConversationResponse)
async def close_conversation(request: CloseConversationRequest):
    """
    Mark all pending tool calls in a conversation as interrupted.

    Called when user stops/interrupts a conversation mid-execution.
    Returns log diff with <Interrupted /> markers for pending tools.
    """
    try:
        start_index = len(request.log)

        # Mark all pending tools as interrupted
        updated_log, _ = update_log_with_completed_tool_calls(
            request.log,
            completed_tool_calls=[],  # No completed tools
            interrupt_pending=True     # Mark pending as <Interrupted />
        )

        # Return only new entries
        logDiff = updated_log[start_index:]
        return CloseConversationResponse(logDiff=logDiff)

    except Exception as e:
        logger.error(f"Error in close_conversation: {str(e)}\n{traceback.format_exc()}")
        # Return empty diff on error
        return CloseConversationResponse(logDiff=[])


@app.post("/api/chat", response_model=ConversationResponse)
async def chat(request: ConversationRequest):
    """Non-streaming conversation API endpoint."""
    try:
        # Use shared conversation processing logic (no callbacks = no streaming)
        return await process_conversation(request)

    except Exception as e:
        # Generate error ID for correlation
        error_id = str(uuid.uuid4())

        # Log full error details server-side
        logger.error(
            f"Error in chat [error_id={error_id}]: {str(e)}\n"
            f"Traceback:\n{traceback.format_exc()}"
        )

        # In production, send generic error; in dev, send detailed error
        is_production = os.getenv("ENVIRONMENT") == "production"

        return ConversationResponse(
            logDiff=[],
            pending_tool_calls=[],
            completed_tool_calls=[],
            llm_calls={},  # Empty dict for error case
            error="An internal error occurred. Please contact support." if is_production else f"[{error_id}] {str(e)}"
        )


@app.post("/api/chat/stream")
async def chat_stream(request: ConversationRequest):
    """Streaming conversation API endpoint with Server-Sent Events (SSE)."""
    # Helper to create SSE formatted event (defined outside generator to avoid unbound warning)
    def format_sse_event(event_type: str, data: dict) -> str:
        return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"

    async def event_generator():
        try:
            # Event queue for streaming
            event_queue = asyncio.Queue()

            # Callback for LLM content streaming
            def on_content(content: str, stream_id: str, content_type: str = 'text'):
                if content_type == 'thinking':
                    event = {
                        "type": "StreamedThinking",
                        "payload": {"chunk": content}
                    }
                    asyncio.create_task(event_queue.put(("StreamedThinking", event)))
                else:
                    event = {
                        "type": "StreamedContent",
                        "payload": {"chunk": content}
                    }
                    asyncio.create_task(event_queue.put(("StreamedContent", event)))

            # Callback for tool call created
            def on_tool_created(task):
                # Convert task to ToolCall format (extract fields from CompressedTask)
                tool_call = {
                    "id": task.unique_id,
                    "type": "function",
                    "function": {
                        "name": task.agent,
                        "arguments": task.args
                    }
                }
                event = {
                    "type": "ToolCreated",
                    "payload": tool_call
                }
                asyncio.create_task(event_queue.put(("ToolCreated", event)))

            # Callback for tool call completed
            def on_tool_completed(task):
                # Convert task to CompletedToolCall format (extract fields from CompressedTask)
                completed_tool_call = {
                    "role": "tool",
                    "tool_call_id": task.unique_id,
                    "content": task.result if task.result is not None else "",
                    "run_id": task.run_id,
                    "function": {
                        "name": task.agent,
                        "arguments": task.args
                    },
                    "created_at": datetime.now(timezone.utc).isoformat()
                }
                event = {
                    "type": "ToolCompleted",
                    "payload": completed_tool_call
                }
                asyncio.create_task(event_queue.put(("ToolCompleted", event)))

            # Run shared conversation processing logic in background with streaming callbacks
            async def run_conversation():
                try:
                    response = await process_conversation(
                        request,
                        on_content=on_content,
                        on_tool_created=on_tool_created,
                        on_tool_completed=on_tool_completed
                    )
                    # Signal completion with the response
                    await event_queue.put(("done", response))
                except Exception as e:
                    # Signal error
                    await event_queue.put(("error", e))

            # Start conversation processing in background
            asyncio.create_task(run_conversation())

            # Stream events as they arrive
            while True:
                event_type, event_data = await event_queue.get()

                if event_type == "done":
                    # Conversation finished, send final done event
                    response: ConversationResponse = event_data

                    # Convert Pydantic models to dicts for JSON serialization
                    log_diff_serialized = [entry.model_dump(by_alias=True) for entry in response.logDiff]
                    pending_serialized = [tc.model_dump(by_alias=True) if hasattr(tc, 'model_dump') else tc for tc in response.pending_tool_calls]
                    # Completed tool calls can be dicts or Pydantic models
                    completed_serialized = []
                    for tc in response.completed_tool_calls:
                        if isinstance(tc, dict):
                            completed_serialized.append(tc)
                        else:
                            completed_serialized.append(tc.model_dump(by_alias=True))
                    llm_calls_serialized = {k: v.model_dump(by_alias=True) for k, v in response.llm_calls.items()}

                    done_event = {
                        "type": "done",
                        "logDiff": log_diff_serialized,
                        "pending_tool_calls": pending_serialized,
                        "completed_tool_calls": completed_serialized,
                        "llm_calls": llm_calls_serialized,
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
                    yield format_sse_event("done", done_event)
                    break
                elif event_type == "error":
                    # Error occurred, propagate it
                    raise event_data
                else:
                    # Stream regular event (all use "streaming_event" as SSE event type)
                    yield format_sse_event("streaming_event", event_data)

        except Exception as e:
            # Generate error ID for correlation
            error_id = str(uuid.uuid4())

            # Log full error details server-side
            logger.error(
                f"Error in chat stream [error_id={error_id}]: {str(e)}\n"
                f"Traceback:\n{traceback.format_exc()}"
            )

            # In production, send generic error; in dev, send detailed error
            is_production = os.getenv("ENVIRONMENT") == "production"

            error_event = {
                "type": "error",
                "error": "An internal error occurred. Please contact support." if is_production else f"[{error_id}] {str(e)}",
                "error_id": error_id,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            yield format_sse_event("error", error_event)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # Disable buffering in nginx
        }
    )


# ---------------------------------------------------------------------------
# Debug endpoints
# ---------------------------------------------------------------------------

class PromptBreakdownRequest(BaseModel):
    agent: str = "AnalystAgent"
    agent_args: dict = {}
    model: str = "claude-sonnet-4-6"
    include_text: bool = False  # include full rendered section text in response


@app.post("/api/debug/prompt-breakdown")
async def debug_prompt_breakdown(request: PromptBreakdownRequest):
    """Return a structured token-cost breakdown of every component sent to the LLM.

    Works for any agent registered in Orchestrator._agent_registry.
    Instantiates the agent with a stub orchestrator (no DB, no LLM calls) and
    measures system prompt sections, user message, and tool schemas.
    """
    def count_tokens(text: str) -> int:
        try:
            if not text:
                return 0
            return litellm.token_counter(model=request.model, text=text)
        except Exception:
            return max(1, len(text) // 4)

    # Look up agent class
    try:
        agent_cls = Orchestrator.get_agent(request.agent)
    except Exception:
        raise HTTPException(status_code=404, detail=f"Agent '{request.agent}' not found in registry")

    # Minimal stub — no DB, no LLM, only prompt assembly
    class _StubOrchestrator:
        def get_previous_root_tasks(self): return []
        onContent = None

    try:
        agent = agent_cls(
            _unique_id="debug",
            orchestrator=_StubOrchestrator(),
            **request.agent_args
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to instantiate agent: {e}")

    loader = PromptLoader()

    def _render_breakdown(prompt_id: str, variables: dict) -> dict:
        raw = loader.breakdown(prompt_id, **variables)
        sections = {}
        for name, info in raw['sections'].items():
            entry: dict = {
                'kind': info['kind'],
                'chars': info['chars'],
                'tokens': count_tokens(info['text']),
            }
            if request.include_text:
                entry['text'] = info['text']
            sections[name] = entry
        # Sort by token cost descending for readability
        sections = dict(sorted(sections.items(), key=lambda kv: -kv[1]['tokens']))
        return {'total_chars': raw['total_chars'], 'sections': sections}

    # System prompt
    sys_args = agent._get_prompt_args()
    if sys_args:
        prompt_id, variables = sys_args
        system_breakdown = _render_breakdown(prompt_id, variables)
        system_breakdown['total_tokens'] = count_tokens(agent._get_system_message()['content'])
    else:
        content = agent._get_system_message()['content']
        system_breakdown = {'total_chars': len(content), 'total_tokens': count_tokens(content), 'sections': {}}

    # User message
    user_args = agent._get_user_prompt_args()
    if user_args:
        prompt_id, variables = user_args
        user_breakdown = _render_breakdown(prompt_id, variables)
        user_msg = agent._get_user_message()
        raw_content = user_msg['content']
        text_content = '\n'.join(b['text'] for b in raw_content if b.get('type') == 'text') \
            if isinstance(raw_content, list) else raw_content
        user_breakdown['total_tokens'] = count_tokens(text_content)
    else:
        user_msg = agent._get_user_message()
        raw_content = user_msg['content']
        text_content = '\n'.join(b['text'] for b in raw_content if b.get('type') == 'text') \
            if isinstance(raw_content, list) else raw_content
        user_breakdown = {'total_chars': len(text_content), 'total_tokens': count_tokens(text_content), 'sections': {}}

    # Tool schemas
    tools = agent._get_available_tools()
    tool_breakdown = []
    for tool_cls in tools:
        schema = describe_tool(tool_cls)
        schema_json = json.dumps(schema)
        entry: dict = {
            'name': schema['function']['name'],
            'chars': len(schema_json),
            'tokens': count_tokens(schema_json),
        }
        if request.include_text:
            entry['schema'] = schema
        tool_breakdown.append(entry)
    tool_breakdown.sort(key=lambda x: -x['tokens'])
    total_tool_tokens = sum(t['tokens'] for t in tool_breakdown)
    total_tool_chars = sum(t['chars'] for t in tool_breakdown)

    # Per-skill breakdown of the preloaded_skills variable
    preloaded_skills_detail = None
    if hasattr(agent, '_get_preloaded_skill_names'):
        preloaded_skills_detail = []
        for name in agent._get_preloaded_skill_names():
            content = get_skill(name)
            if content:
                preloaded_skills_detail.append({
                    'name': name,
                    'chars': len(content),
                    'tokens': count_tokens(content),
                })

    # Known large embedded blobs inside tool field descriptions
    embedded_blobs = {
        'ATLAS_FILE_SCHEMA_JSON': {
            'chars': len(ATLAS_FILE_SCHEMA_JSON),
            'tokens': count_tokens(ATLAS_FILE_SCHEMA_JSON),
            'note': 'Embedded in EditFile.changes field description',
        },
        'vizSettingsJsonStr': {
            'chars': len(vizSettingsJsonStr),
            'tokens': count_tokens(vizSettingsJsonStr),
            'note': 'Subset of ATLAS_FILE_SCHEMA_JSON, also in ExecuteQuery.vizSettings — sent twice',
        },
    }

    grand_total = system_breakdown['total_tokens'] + user_breakdown['total_tokens'] + total_tool_tokens

    return {
        'agent': request.agent,
        'model': request.model,
        'system_prompt': system_breakdown,
        'user_message': user_breakdown,
        'tools': {
            'total_chars': total_tool_chars,
            'total_tokens': total_tool_tokens,
            'breakdown': tool_breakdown,
        },
        'preloaded_skills_detail': preloaded_skills_detail,
        'embedded_blobs': embedded_blobs,
        'grand_total_tokens': grand_total,
    }
