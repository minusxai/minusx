from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ConfigDict
from database import infer_type_from_value
from sqlalchemy import text
import threading
import uuid
import json
import asyncio
import logging
import traceback
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List, Callable
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncEngine

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables from .env file
load_dotenv()

from connection_manager import connection_manager
from connectors import get_async_connector
from pipelines.executor import PipelineExecutor
from pipelines.tap_tester import test_tap
from processors import process_csv_upload, delete_csv_connection
from processors import process_google_sheets_import, delete_google_sheets_connection
from sql_utils.limit_enforcer import enforce_query_limit
from autocomplete import get_completions, AutocompleteRequest, get_mention_completions, MentionItem
from sql_ir import parse_sql_to_ir, ir_to_sql, UnsupportedSQLError, QueryIR

# Import orchestration components
from tasks import Orchestrator, AgentCall, UserInputException
from tasks.orchestrator import ConversationLog
from tasks.conversation import get_latest_root, update_log_with_completed_tool_calls, get_pending_tool_calls, get_completed_tool_calls
from tasks.types import ChatCompletionToolMessageParamMX, ChatCompletionMessageToolCallParamMX, CompletedToolCallsMXWithRunId

app = FastAPI(title="MinusX BI Backend")

# In-memory execution tracker (future: move to database)
pipeline_executions: Dict[str, Dict[str, Any]] = {}

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Next.js frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    query: str
    parameters: dict = {}
    database_name: str = "default"
    session_token: Optional[str] = None  # Session token for internal API auth
    # NOTE: connection_type and connection_config are NO LONGER needed!
    # Python backend fetches config from Next.js automatically via internal API


class QueryResponse(BaseModel):
    columns: list[str]
    types: list[str]
    rows: list[dict]


class ConnectionInitialize(BaseModel):
    type: str  # 'duckdb' | 'bigquery'
    config: dict


class TestConnectionRequest(BaseModel):
    name: str | None = None  # Connection name (for existing connections)
    type: str  # 'duckdb' | 'bigquery'
    config: dict
    include_schema: bool = False  # Whether to fetch schema (default: False for performance)


class SchemaTable(BaseModel):
    table: str
    columns: list[dict]


class SchemaResponse(BaseModel):
    tables: list[SchemaTable]


class TestConnectionResponse(BaseModel):
    success: bool
    message: str
    schema: list[dict] | None = None  # Optional schema returned on successful test


class PipelineRunRequest(BaseModel):
    connector_name: str  # Name of connector (e.g., "facebook_ads_daily")
    pipeline_config: dict  # Full pipeline configuration


class PipelineRunResponse(BaseModel):
    execution_id: str
    status: str  # "queued"
    message: str


class PipelineStatusResponse(BaseModel):
    execution_id: str
    status: str  # "queued" | "running" | "success" | "failed"
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    records_processed: int = 0
    duration_seconds: Optional[float] = None
    error: Optional[str] = None
    logs: Optional[dict] = None


class TapTestRequest(BaseModel):
    tap_name: str  # e.g., "tap-facebook"
    config: dict  # Tap configuration


class TapTestResponse(BaseModel):
    success: bool
    message: str
    details: Optional[dict] = None


@app.on_event("startup")
async def startup_event():
    """Python backend starts with empty connection pool"""
    print("[Backend] Python backend ready. Connections will be initialized by Next.js.")


@app.get("/")
async def root():
    return {"message": "MinusX BI Backend API", "status": "running"}


def _get_dialect_for_connection(conn_type: str) -> str:
    """
    Map connection type to sqlglot dialect for query parsing.

    Args:
        conn_type: Connection type from connector (e.g., 'postgresql', 'duckdb', 'bigquery')

    Returns:
        Sqlglot dialect name
    """
    dialect_map = {
        'duckdb': 'duckdb',
        'bigquery': 'bigquery',
        'postgresql': 'postgres',
        'csv': 'duckdb',  # CSV uses DuckDB engine
        'google-sheets': 'duckdb',  # Google Sheets uses DuckDB engine
    }
    return dialect_map.get(conn_type, 'postgres')


@app.post("/api/execute-query", response_model=QueryResponse)
async def execute_sql_query(query_request: QueryRequest, request: Request):
    """
    Execute a SQL query on the specified database connection.

    Uses idempotent initialization: Python backend fetches connection config from Next.js if needed.

    Args:
        query_request: QueryRequest with SQL query, database_name, and optional parameters
        request: FastAPI Request object to access headers

    Returns:
        QueryResponse with columns and rows
    """
    import time
    start_time = time.time()
    print(f"[PYTHON] Start execute-query for database: {query_request.database_name}")

    try:
        # Extract company_id from header (required for multi-tenant isolation)
        company_id_header = request.headers.get('x-company-id')
        if not company_id_header:
            raise HTTPException(status_code=400, detail="Missing x-company-id header - required for multi-tenant isolation")

        try:
            company_id = int(company_id_header)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid x-company-id header - must be an integer")

        # Extract mode from header (for mode-based isolation)
        mode = request.headers.get('x-mode', 'org')  # Default to 'org' if not provided

        # Idempotent connection initialization: fetch config from Next.js if not cached
        init_start = time.time()
        connector = await connection_manager.get_or_initialize_connection(
            query_request.database_name,
            company_id,
            query_request.session_token,
            mode
        )
        engine = await connector.get_engine()
        print(f"[PYTHON] Connection init took {(time.time() - init_start) * 1000:.2f}ms")

        # Enforce query limits for safety (add LIMIT if missing, cap at max)
        dialect = _get_dialect_for_connection(connector.conn_type)
        safe_query = enforce_query_limit(
            query_request.query,
            default_limit=1000,
            max_limit=10000,
            dialect=dialect
        )

        # Execute query (detect engine type)
        exec_start = time.time()

        if isinstance(engine, AsyncEngine):
            # True async execution (PostgreSQL)
            async with engine.connect() as connection:
                if query_request.parameters:
                    result = await connection.execute(text(safe_query), query_request.parameters)
                else:
                    result = await connection.execute(text(safe_query))
                print(f"[PYTHON] Query execution took {(time.time() - exec_start) * 1000:.2f}ms")

                # Get column names
                process_start = time.time()
                columns = list(result.keys())

                # Get rows as list of dictionaries
                rows = [dict(row._mapping) for row in result]
                print(f"[PYTHON] Result processing (rows: {len(rows)}) took {(time.time() - process_start) * 1000:.2f}ms")

                # Get types from SQLAlchemy result metadata
                types = []
                try:
                    keys_dict = {key.name: key for key in result._metadata.keys}
                    for col_name in columns:
                        col_type = keys_dict[col_name].type
                        type_str = str(col_type)
                        if '(' in type_str:
                            type_str = type_str.split('(')[0]
                        types.append(type_str)
                except (AttributeError, KeyError, TypeError):
                    for col in columns:
                        inferred_type = 'NULL'
                        for row in rows:
                            if row.get(col) is not None:
                                inferred_type = infer_type_from_value(row[col])
                                break
                        types.append(inferred_type)
        else:
            # Sync engine in thread pool (DuckDB, BigQuery)
            def _execute_sync():
                with engine.connect() as connection:
                    if query_request.parameters:
                        result = connection.execute(text(safe_query), query_request.parameters)
                    else:
                        result = connection.execute(text(safe_query))

                    # Get column names and rows
                    columns = list(result.keys())
                    rows = [dict(row._mapping) for row in result]

                    # Get types from SQLAlchemy result metadata
                    types = []
                    try:
                        keys_dict = {key.name: key for key in result._metadata.keys}
                        for col_name in columns:
                            col_type = keys_dict[col_name].type
                            type_str = str(col_type)
                            if '(' in type_str:
                                type_str = type_str.split('(')[0]
                            types.append(type_str)
                    except (AttributeError, KeyError, TypeError):
                        for col in columns:
                            inferred_type = 'NULL'
                            for row in rows:
                                if row.get(col) is not None:
                                    inferred_type = infer_type_from_value(row[col])
                                    break
                            types.append(inferred_type)

                    return columns, rows, types

            columns, rows, types = await asyncio.to_thread(_execute_sync)
            print(f"[PYTHON] Query execution took {(time.time() - exec_start) * 1000:.2f}ms")
            process_start = time.time()
            print(f"[PYTHON] Result processing (rows: {len(rows)}) took {(time.time() - process_start) * 1000:.2f}ms")

        print(f"[PYTHON] Total execute-query time: {(time.time() - start_time) * 1000:.2f}ms")
        return {
            "columns": columns,
            "types": types,
            "rows": rows
        }
    except ValueError as e:
        print(f"[PYTHON] Error after {(time.time() - start_time) * 1000:.2f}ms: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        print(f"[PYTHON] Error after {(time.time() - start_time) * 1000:.2f}ms: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/connections/{name}/initialize")
async def initialize_connection(name: str, conn: ConnectionInitialize):
    """Initialize a connection in-memory (called by Next.js)"""
    try:
        connector = get_async_connector(name, conn.type, conn.config)
        print(f"[Connection Init] Initializing connection '{name}' of type '{conn.type}'")
        validation = connector.validate_config()
        if not validation['valid']:
            raise HTTPException(status_code=400, detail=validation['errors'])

        # Add to connection manager
        connection_manager._connections[name] = connector

        # Get schema to return in response
        schema = await connector.get_schema()

        return {
            "success": True,
            "message": f"Initialized: {name}",
            "schema": {"schemas": schema}
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Connection Init Error] Failed to initialize '{name}': {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/connections/{name}/remove")
async def remove_connection(name: str):
    """Remove connection from memory"""
    if name in connection_manager._connections:
        del connection_manager._connections[name]
    return {"success": True}


@app.get("/api/connections/health")
async def connections_health():
    """Report initialized connections"""
    return {
        "initialized": list(connection_manager._connections.keys()),
        "count": len(connection_manager._connections)
    }


@app.post("/api/connections/reinitialize")
async def reinitialize_connections():
    """Clear all cached connections so they are re-fetched from the DB on next use.
    Called after a database migration to pick up updated connection configs."""
    await connection_manager.close_all()
    return {"success": True}


@app.post("/api/connections/test", response_model=TestConnectionResponse)
async def test_connection(req: TestConnectionRequest):
    """
    Unified connection test endpoint.
    - Always tests the provided config (allows testing unsaved changes)
    - name is optional and used only for display/logging purposes
    - include_schema: Optionally fetch schema (default: False for performance)
    """
    try:
        # Always use the provided config for testing
        # This allows testing edited configs before saving
        connector = get_async_connector(
            req.name or "temp_test",  # Use name for logging if provided
            req.type,
            req.config
        )

        # Validate configuration
        validation = connector.validate_config()
        if not validation['valid']:
            await connector.close()
            return {"success": False, "message": "; ".join(validation['errors']), "schema": None}

        # Test the connection with timeout
        try:
            result = await asyncio.wait_for(
                connector.test_connection(),
                timeout=30.0
            )
        except asyncio.TimeoutError:
            await connector.close()
            return {"success": False, "message": "Connection test timed out", "schema": None}

        # Optionally fetch schema if requested
        if result.get('success') and req.include_schema:
            try:
                schema = await asyncio.wait_for(
                    connector.get_schema(),
                    timeout=60.0
                )
                result['schema'] = schema
            except asyncio.TimeoutError:
                print(f"[test_connection] Schema fetch timed out")
                result['schema'] = None
            except Exception as schema_error:
                print(f"[test_connection] Schema fetch failed: {schema_error}")
                # Don't fail the test if schema fetch fails
                result['schema'] = None

        # Always cleanup temporary connector
        await connector.close()

        return result
    except Exception as e:
        return {"success": False, "message": str(e), "schema": None}


@app.post("/api/connections/{name}/schema")
async def get_connection_schema(name: str, conn: ConnectionInitialize):
    """
    Get database schema using provided connection config.
    Creates a temporary connector to fetch schema without caching.
    """
    try:
        # Create connector directly from provided config
        connector = get_async_connector(name, conn.type, conn.config)

        # Validate config
        validation = connector.validate_config()
        if not validation['valid']:
            await connector.close()
            raise HTTPException(status_code=400, detail=f"Invalid connection config: {validation['errors']}")

        # Get schema with timeout
        try:
            schema = await asyncio.wait_for(
                connector.get_schema(),
                timeout=60.0
            )
        except asyncio.TimeoutError:
            await connector.close()
            raise HTTPException(status_code=504, detail="Schema fetch timed out")

        # Cleanup
        await connector.close()

        return {"schemas": schema}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[get_connection_schema] Error fetching schema for '{name}': {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


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
            request.database_name
        )
        return {"suggestions": [s.dict() for s in suggestions]}
    except Exception as e:
        logger.error(f"Autocomplete error: {e}")
        import traceback
        traceback.print_exc()
        return {"suggestions": []}


class InferColumnsRequest(BaseModel):
    """Request to infer output columns from a SQL query"""
    query: str
    schema_data: List[Dict[str, Any]] = []
    dialect: Optional[str] = None


class InferredColumn(BaseModel):
    name: str
    type: str


class InferColumnsResponse(BaseModel):
    columns: List[InferredColumn]
    error: Optional[str] = None


@app.post("/api/infer-columns", response_model=InferColumnsResponse)
async def infer_columns_endpoint(request: InferColumnsRequest):
    """
    Infer output column names and types from a SQL query using sqlglot.
    Does not execute the query - uses static analysis only.
    Falls back to 'unknown' type for unresolvable expressions.
    """
    try:
        import sqlglot
        from sqlglot import exp as sqlexp

        dialect = request.dialect or "postgres"
        ast = sqlglot.parse_one(request.query, read=dialect)

        # Find the outermost SELECT statement
        select_stmt = ast
        if not isinstance(select_stmt, sqlexp.Select):
            # Try to find a Select node
            select_stmt = ast.find(sqlexp.Select)

        if not select_stmt:
            return InferColumnsResponse(columns=[], error="Could not find SELECT statement")

        columns: List[InferredColumn] = []
        for expr in select_stmt.expressions:
            # Determine column name
            if isinstance(expr, sqlexp.Alias):
                col_name = expr.alias
                inner = expr.this
            elif isinstance(expr, sqlexp.Column):
                col_name = expr.name
                inner = expr
            elif isinstance(expr, sqlexp.Star):
                # SELECT * - try to expand from schema_data
                # schema_data structure: [{databaseName, schemas: [{schema, tables: [{table, columns}]}]}]
                if request.schema_data:
                    for schema_entry in request.schema_data:
                        for schema_obj in schema_entry.get("schemas", []):
                            for table_entry in schema_obj.get("tables", []):
                                for col in table_entry.get("columns", []):
                                    columns.append(InferredColumn(
                                        name=col.get("name", "?"),
                                        type=col.get("type", "unknown")
                                    ))
                else:
                    columns.append(InferredColumn(name="*", type="unknown"))
                continue
            else:
                # Use SQL text as name fallback
                col_name = expr.sql(dialect=dialect)
                inner = expr

            # Determine type - try to infer from expression
            col_type = "unknown"
            if isinstance(inner, sqlexp.Cast):
                col_type = inner.to.sql(dialect=dialect).lower()
            elif isinstance(inner, sqlexp.Anonymous) or isinstance(inner, sqlexp.Func):
                func_name = inner.sql_name().lower() if hasattr(inner, 'sql_name') else ""
                if any(x in func_name for x in ("count", "sum", "avg", "min", "max")):
                    col_type = "number"
                elif any(x in func_name for x in ("date", "timestamp", "now", "current")):
                    col_type = "timestamp"
                elif any(x in func_name for x in ("concat", "lower", "upper", "trim", "substr")):
                    col_type = "text"
            elif isinstance(inner, sqlexp.Literal):
                if inner.is_number:
                    col_type = "number"
                else:
                    col_type = "text"
            elif isinstance(inner, sqlexp.Column):
                # Try to look up column type from schema_data
                # schema_data structure: [{databaseName, schemas: [{schema, tables: [{table, columns}]}]}]
                col_ref_name = inner.name
                table_ref = inner.table if inner.table else None
                for schema_entry in request.schema_data:
                    for schema_obj in schema_entry.get("schemas", []):
                        for table_entry in schema_obj.get("tables", []):
                            if table_ref and table_entry.get("table") != table_ref:
                                continue
                            for col in table_entry.get("columns", []):
                                if col.get("name") == col_ref_name:
                                    col_type = col.get("type", "unknown")
                                    break

            columns.append(InferredColumn(name=col_name, type=col_type))

        return InferColumnsResponse(columns=columns)

    except Exception as e:
        logger.warning(f"[infer-columns] Error inferring columns: {e}")
        return InferColumnsResponse(columns=[], error=str(e))


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
        import traceback
        traceback.print_exc()
        return {"suggestions": []}


class SqlToIRRequest(BaseModel):
    sql: str
    database_name: Optional[str] = None  # For future schema context


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
        ir = parse_sql_to_ir(req.sql)
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
                "UNION": "UNION queries are not supported in GUI mode",
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
        # Validate and parse IR
        ir = QueryIR.model_validate(req.ir)
        sql = ir_to_sql(ir)

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


def _execute_pipeline_background(execution_id: str, pipeline_config: Dict[str, Any]):
    """
    Background worker function for pipeline execution.
    """
    # Update status to running
    pipeline_executions[execution_id]["status"] = "running"

    try:
        executor = PipelineExecutor(pipeline_config, connection_manager)
        result = executor.execute()

        # Update execution record with results
        pipeline_executions[execution_id].update({
            "status": result["status"],
            "completed_at": datetime.now().isoformat(),
            "records_processed": result["records_processed"],
            "duration_seconds": result["duration_seconds"],
            "tap_stderr": result.get("tap_stderr", ""),
            "target_stdout": result.get("target_stdout", ""),
            "target_stderr": result.get("target_stderr", ""),
            "error": result.get("error")
        })

    except Exception as e:
        pipeline_executions[execution_id].update({
            "status": "failed",
            "completed_at": datetime.now().isoformat(),
            "error": str(e)
        })


@app.post("/api/pipelines/run", response_model=PipelineRunResponse)
async def run_pipeline(request: PipelineRunRequest):
    """
    Start a pipeline execution asynchronously.

    Returns immediately with execution_id for status polling.
    """
    try:
        # Use the pipeline config from the request (sent by frontend)
        pipeline_config = request.pipeline_config

        # Create execution record
        execution_id = str(uuid.uuid4())
        pipeline_executions[execution_id] = {
            "execution_id": execution_id,
            "status": "queued",
            "started_at": datetime.now().isoformat(),
            "connector_name": request.connector_name,
            "pipeline_config": pipeline_config
        }

        # Start execution in background thread
        thread = threading.Thread(
            target=_execute_pipeline_background,
            args=(execution_id, pipeline_config)
        )
        thread.daemon = True
        thread.start()

        return {
            "execution_id": execution_id,
            "status": "queued",
            "message": "Pipeline execution started"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/pipelines/status/{execution_id}", response_model=PipelineStatusResponse)
async def get_pipeline_status(execution_id: str):
    """
    Get status of a pipeline execution.
    """
    if execution_id not in pipeline_executions:
        raise HTTPException(status_code=404, detail="Execution not found")

    execution = pipeline_executions[execution_id]

    return {
        "execution_id": execution_id,
        "status": execution["status"],
        "started_at": execution.get("started_at"),
        "completed_at": execution.get("completed_at"),
        "records_processed": execution.get("records_processed", 0),
        "duration_seconds": execution.get("duration_seconds"),
        "error": execution.get("error"),
        "logs": {
            "tap_stderr": execution.get("tap_stderr", ""),
            "target_stdout": execution.get("target_stdout", ""),
            "target_stderr": execution.get("target_stderr", "")
        }
    }


@app.post("/api/connectors/test", response_model=TapTestResponse)
async def test_connector(request: TapTestRequest):
    """
    Test a tap configuration without running the full pipeline.

    Currently supports: tap-facebook
    """
    try:
        result = test_tap(request.tap_name, request.config)
        return result
    except Exception as e:
        return {
            "success": False,
            "message": f"Test failed: {str(e)}"
        }


# ============================================================================
# CSV Upload API
# ============================================================================

class CsvUploadResponse(BaseModel):
    success: bool
    message: str
    config: Optional[dict] = None  # Contains generated_db_path and files metadata


class CsvDeleteResponse(BaseModel):
    success: bool
    message: str


@app.post("/api/csv/upload", response_model=CsvUploadResponse)
async def upload_csv_files(
    request: Request,
    connection_name: str = Form(...),
    replace_existing: bool = Form(False),
    files: List[UploadFile] = File(...)
):
    """
    Upload CSV files and generate a DuckDB database.

    This endpoint:
    1. Saves uploaded CSV files to data/csv_connections/{company_id}/{mode}/{connection_name}/files/
    2. Creates a DuckDB database with tables from each CSV
    3. Returns metadata for storing in the connection config

    Args:
        connection_name: Name for the connection (used as folder name)
        replace_existing: If True, replace existing files; if False, error on existing
        files: List of CSV files to upload

    Returns:
        CsvUploadResponse with generated_db_path and file metadata
    """
    try:
        # Extract company_id from header
        company_id_header = request.headers.get('x-company-id')
        if not company_id_header:
            raise HTTPException(status_code=400, detail="Missing x-company-id header")

        try:
            company_id = int(company_id_header)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid x-company-id header - must be an integer")

        # Extract mode from header (defaults to 'org' if not provided)
        mode = request.headers.get('x-mode', 'org')

        # Validate files
        if not files:
            raise HTTPException(status_code=400, detail="At least one CSV file is required")

        # Validate file extensions
        for file in files:
            if not file.filename:
                raise HTTPException(status_code=400, detail="File must have a filename")
            if not file.filename.lower().endswith('.csv'):
                raise HTTPException(status_code=400, detail=f"File '{file.filename}' is not a CSV file")

        # Read file contents
        file_data = []
        for file in files:
            content = await file.read()
            file_data.append((file.filename, content))

        # Process CSV upload
        result = await process_csv_upload(
            company_id=company_id,
            mode=mode,
            connection_name=connection_name,
            files=file_data,
            replace_existing=replace_existing
        )

        return CsvUploadResponse(
            success=True,
            message=f"Successfully uploaded {len(files)} CSV file(s)",
            config=result
        )

    except ValueError as e:
        return CsvUploadResponse(
            success=False,
            message=str(e),
            config=None
        )
    except RuntimeError as e:
        return CsvUploadResponse(
            success=False,
            message=str(e),
            config=None
        )
    except Exception as e:
        logger.error(f"CSV upload error: {str(e)}\n{traceback.format_exc()}")
        return CsvUploadResponse(
            success=False,
            message=f"Upload failed: {str(e)}",
            config=None
        )


@app.delete("/api/csv/delete/{connection_name}", response_model=CsvDeleteResponse)
async def delete_csv_data(connection_name: str, request: Request):
    """
    Delete CSV connection data (files and database).

    This should be called when deleting a CSV connection to clean up the data files.

    Args:
        connection_name: Name of the connection to delete data for

    Returns:
        CsvDeleteResponse indicating success/failure
    """
    try:
        # Extract company_id from header
        company_id_header = request.headers.get('x-company-id')
        if not company_id_header:
            raise HTTPException(status_code=400, detail="Missing x-company-id header")

        try:
            company_id = int(company_id_header)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid x-company-id header - must be an integer")

        # Extract mode from header (defaults to 'org' if not provided)
        mode = request.headers.get('x-mode', 'org')

        # Delete the CSV connection data
        deleted = delete_csv_connection(company_id, mode, connection_name)

        if deleted:
            return CsvDeleteResponse(
                success=True,
                message=f"Successfully deleted CSV data for connection '{connection_name}'"
            )
        else:
            return CsvDeleteResponse(
                success=True,
                message=f"No CSV data found for connection '{connection_name}'"
            )

    except Exception as e:
        logger.error(f"CSV delete error: {str(e)}\n{traceback.format_exc()}")
        return CsvDeleteResponse(
            success=False,
            message=f"Delete failed: {str(e)}"
        )


# ============================================================================
# Google Sheets API
# ============================================================================

class GoogleSheetsImportRequest(BaseModel):
    connection_name: str
    spreadsheet_url: str
    replace_existing: bool = False


class GoogleSheetsImportResponse(BaseModel):
    success: bool
    message: str
    config: Optional[dict] = None  # Contains spreadsheet_url, spreadsheet_id, generated_db_path, files


class GoogleSheetsDeleteResponse(BaseModel):
    success: bool
    message: str


@app.post("/api/google-sheets/import", response_model=GoogleSheetsImportResponse)
async def import_google_sheets(request_body: GoogleSheetsImportRequest, request: Request):
    """
    Import a public Google Sheet and create a DuckDB database.

    This endpoint:
    1. Downloads the spreadsheet as xlsx via Google's export endpoint
    2. Extracts each sheet as a CSV file
    3. Creates a DuckDB database with tables from each sheet
    4. Returns metadata for storing in the connection config

    Args:
        request_body: GoogleSheetsImportRequest with URL and connection name
        request: FastAPI Request object for headers

    Returns:
        GoogleSheetsImportResponse with generated config
    """
    try:
        # Extract company_id from header
        company_id_header = request.headers.get('x-company-id')
        if not company_id_header:
            raise HTTPException(status_code=400, detail="Missing x-company-id header")

        try:
            company_id = int(company_id_header)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid x-company-id header - must be an integer")

        # Extract mode from header (defaults to 'org' if not provided)
        mode = request.headers.get('x-mode', 'org')

        # Process Google Sheets import
        result = await process_google_sheets_import(
            company_id=company_id,
            mode=mode,
            connection_name=request_body.connection_name,
            spreadsheet_url=request_body.spreadsheet_url,
            replace_existing=request_body.replace_existing
        )

        return GoogleSheetsImportResponse(
            success=True,
            message=f"Successfully imported {len(result['files'])} sheet(s) from Google Sheets",
            config=result
        )

    except ValueError as e:
        return GoogleSheetsImportResponse(
            success=False,
            message=str(e),
            config=None
        )
    except RuntimeError as e:
        return GoogleSheetsImportResponse(
            success=False,
            message=str(e),
            config=None
        )
    except Exception as e:
        logger.error(f"Google Sheets import error: {str(e)}\n{traceback.format_exc()}")
        return GoogleSheetsImportResponse(
            success=False,
            message=f"Import failed: {str(e)}",
            config=None
        )


@app.delete("/api/google-sheets/delete/{connection_name}", response_model=GoogleSheetsDeleteResponse)
async def delete_google_sheets_data(connection_name: str, request: Request):
    """
    Delete Google Sheets connection data (files and database).

    This should be called when deleting a Google Sheets connection to clean up the data files.

    Args:
        connection_name: Name of the connection to delete data for

    Returns:
        GoogleSheetsDeleteResponse indicating success/failure
    """
    try:
        # Extract company_id from header
        company_id_header = request.headers.get('x-company-id')
        if not company_id_header:
            raise HTTPException(status_code=400, detail="Missing x-company-id header")

        try:
            company_id = int(company_id_header)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid x-company-id header - must be an integer")

        # Extract mode from header (defaults to 'org' if not provided)
        mode = request.headers.get('x-mode', 'org')

        # Delete the Google Sheets connection data
        deleted = delete_google_sheets_connection(company_id, mode, connection_name)

        if deleted:
            return GoogleSheetsDeleteResponse(
                success=True,
                message=f"Successfully deleted Google Sheets data for connection '{connection_name}'"
            )
        else:
            return GoogleSheetsDeleteResponse(
                success=True,
                message=f"No Google Sheets data found for connection '{connection_name}'"
            )

    except Exception as e:
        logger.error(f"Google Sheets delete error: {str(e)}\n{traceback.format_exc()}")
        return GoogleSheetsDeleteResponse(
            success=False,
            message=f"Delete failed: {str(e)}"
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
    extra: Optional[dict] = None  # Contains full request/response


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
    Extract LLM call details from logDiff and strip 'extra' field from entries.

    This function performs two operations in one pass:
    1. Extracts LLM debug data into a dict mapping llm_call_id -> LLMCallDetail
    2. Strips 'extra' field from all LLMDebug entries (modifies log_diff in-place)

    The extracted dict contains full debug data including 'extra' for debugging,
    while the log_diff has 'extra' removed to reduce file size when persisted.

    Args:
        log_diff: List of conversation log entries (modified in-place)

    Returns:
        Dictionary mapping llm_call_id to detailed call information (with 'extra')
    """
    from tasks.orchestrator import TaskDebugLog

    llm_calls: Dict[str, LLMCallDetail] = {}

    for entry in log_diff:
        # Only process TaskDebugLog entries
        if not isinstance(entry, TaskDebugLog):
            continue

        # Extract LLM debug entries
        for llm_debug in entry.llmDebug:
            call_id = llm_debug.lllm_call_id

            # Extract to dict first (while extra is still present)
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
                    extra=llm_debug.extra  # Full request/response
                )

            # Strip extra from log_diff entry (reduces persisted size)
            llm_debug.extra = None

    return llm_calls


@app.get("/api/tools/schema")
async def get_tool_schemas():
    """Return OpenAI function schemas for all registered tools (dev tool tester)."""
    from tasks.llm.client import describe_tool
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
        import os
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
            def on_content(content: str, stream_id: str):
                event = {
                    "type": "StreamedContent",
                    "payload": {
                        "chunk": content
                    }
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
            import os
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
