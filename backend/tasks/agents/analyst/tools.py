"""Analyst Tools - executed by Next.js backend."""
from typing import Optional, List, Any, Dict
from tasks import Tool, UserInputException, register_agent
from pydantic import BaseModel, Field
import json

from tasks.agents.analyst.file_schema import vizSettingsJsonStr, ATLAS_FILE_SCHEMA_NO_VIZ_JSON
from tasks.agents.analyst.prompt_loader import get_skill, list_skills
from sql_utils.table_validator import validate_query_tables

@register_agent
class LoadSkill(Tool):
    """Load detailed instructions for a specific domain (e.g., alerts, reports, parameters, visualizations, composed_questions).

    Use this before working with file types or features you need more context on.
    Returns the full skill content as a tool result — no round-trip to the frontend.
    """

    def __init__(
        self,
        name: str = Field(..., description="Skill name to load (e.g., 'alerts', 'reports'). See the skills catalog in the system prompt for the full list."),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.name = name

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        content = get_skill(self.name)
        if content is None:
            available = list(list_skills().keys())
            return json.dumps({
                'success': False,
                'error': f"Skill '{self.name}' not found. Available skills: {available}"
            })
        return json.dumps({
            'success': True,
            'skill': self.name,
            'content': content
        })


@register_agent
class SearchDBSchema(Tool):
    """Search database schema for tables, columns, and metadata.

    Auto-detects query type: queries starting with '$' use JSONPath, others use weighted string search.

    JSONPath Examples (queries starting with $):
    - "$[*].tables[*]" - Get all tables across all schemas
    - "$[?(@.schema=='Sales')]" - Find specific schema by name
    - "$..columns[?(@.type=='VARCHAR')]" - Find all VARCHAR columns
    - "$..columns[?(@.name.match(/region/i))]" - Find columns with 'region' in name (regex)
    - "$..tables[?(@.table.match(/^sales/i))]" - Find tables starting with 'sales'
    - "$..columns[*].name" - Get all column names only

    String Search Examples (no $ prefix - RECOMMENDED for most cases):
    - "region" - Finds schemas/tables/columns containing 'region' (weighted scoring)
    - "customer" - Searches ALL levels with relevance ranking
    - "email" - Returns scored results showing WHERE matches occurred

    Note: For simple name searches, string search is easier and returns better results with scoring.
    Use JSONPath for structural queries (filter by type, extract specific fields, etc).

    Returns:
    - String search: {results: [{schema, score, matchCount, relevantResults}], ...}
    - JSONPath: {schema: [...extracted data with _schema and _table context...], ...}
      - Extracted items include _schema and _table fields showing where they came from
      - Example: {name: "CustomerID", type: "BIGINT", _schema: "Sales", _table: "Customer"}
    """

    def __init__(
        self,
        connection_id: str = Field(..., description="the database connection ID to use"),
        query: Optional[str] = Field(None, description="JSONPath query (starts with '$') or string search term"),
        _schema: Optional[List[dict]] = None,
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.connection_id = connection_id
        self.query = query
        self._schema = _schema

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Signal that this tool needs Next.js backend execution
        raise UserInputException(self._unique_id)

@register_agent
class SearchFiles(Tool):
    """Search files by name, description, or content across questions and dashboards.
    - Purpose: Find existing questions/dashboards that might be relevant
    - Parameters:
        - query (required): Search term to find in file names, descriptions, and content
        - file_types (optional): ['question', 'dashboard'] - defaults to both
        - folder_path (optional): Folder to search in - defaults to your home folder
        - limit (optional): Max results to return - defaults to 20
        - offset (optional): Skip first N results - defaults to 0 for pagination
    - Returns: Ranked results with match snippets showing WHERE the query matched
    - Example: SearchFiles(query="revenue analysis") to find revenue-related files
    """

    def __init__(
        self,
        query: str = Field(..., description="Search term to find in file names, descriptions, and content"),
        file_types: Optional[List[str]] = Field(None, description="File types to search: 'question', 'dashboard'. Default: both"),
        folder_path: Optional[str] = Field(None, description="Folder path to search within (default: user's home folder)"),
        depth: int = Field(999, description="Folder depth to search (default: 999 for all subfolders)"),
        limit: int = Field(20, description="Maximum number of results to return (default: 20)"),
        offset: int = Field(0, description="Number of results to skip for pagination (default: 0)"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.query = query
        self.file_types = file_types
        self.folder_path = folder_path
        self.depth = depth
        self.limit = limit
        self.offset = offset

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Signal that this tool needs Next.js backend execution
        raise UserInputException(self._unique_id)


@register_agent
class Navigate(Tool):
    """Navigate user to a specific file, folder, or new file creation page.
    Use this tool to direct users to different pages in the app.

    Valid combinations:
    - file_id only: Navigate to existing file
    - path only: Navigate to folder
    - newFileType only: Create new file in default folder
    - newFileType + path: Create new file in specified folder

    Invalid combinations:
    - file_id + newFileType

    Examples:
    - Navigate to file: Navigate(file_id=123)
    - Navigate to folder: Navigate(path="/org/reports")
    - Create new dashboard: Navigate(newFileType="dashboard")
    - Create new question in folder: Navigate(newFileType="question", path="/org/reports")
    - If you don't want to use an argument don't pass it at all. Don't try to pass empty or null values.

    Returns:
    - Notifies of the success of navigation and the new app state
    """

    def __init__(
        self,
        file_id: Optional[int] = Field(None, description="File ID to navigate to (optional, eg: 123 -> /f/123)"),
        path: Optional[str] = Field(None, description="Folder path to navigate to (optional, eg: '/org/reports' -> /p/org/reports)"),
        newFileType: Optional[str] = Field(None, description="Type of new file to create: 'question', 'dashboard', etc. (optional, question -> /new/question)"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.file_id = file_id
        self.path = path
        self.newFileType = newFileType

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Validate parameter combinations
        if self.file_id is None and self.path is None and self.newFileType is None:
            return json.dumps({
                'success': False,
                'error': 'Must provide at least one of: file_id, path, or newFileType'
            })
        
        if self.file_id:
            failed = False
            try:
                if not int(self.file_id):
                    failed = True
            except Exception:
                failed = True
            if failed:
                return json.dumps({
                        'success': False,
                        'error': f"Invalid file_id {self.file_id}. If you do not want to provide it, don't pass it at all."
                    })

        # Signal that this tool needs frontend execution
        raise UserInputException(self._unique_id)


@register_agent
class Clarify(Tool):
    """Ask the user for clarification when their request is ambiguous.

    Use this tool when:
    - User's request has multiple valid interpretations
    - You need to choose between different approaches
    - Additional information is needed to proceed

    Returns:
    - success: true if user selected, false if user cancelled
    - message: "User selected: <label>" or "User cancelled the clarification request"
    - selection: The full option object(s) selected by user (single object or array if multiSelect)

    Example:
    Clarify(
        question="What time range do you want to analyze?",
        options=[
            {"label": "Last 7 days", "description": "Recent data"},
            {"label": "Last 30 days", "description": "Monthly view"},
            {"label": "Last 90 days", "description": "Quarterly view"}
        ],
        multiSelect=False
    )
    - Try to limit to 3 options for best user experience.
    - Use multiSelect=True if multiple selections are allowed.
    """

    def __init__(
        self,
        question: str = Field(..., description="The question to ask the user"),
        options: List[dict] = Field(..., description="List of options, each with label (str) and optional description (str)"),
        multiSelect: bool = Field(False, description="If true, user can select multiple options"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.question = question
        self.options = options
        self.multiSelect = multiSelect

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        raise UserInputException(self._unique_id)


@register_agent
class TalkToUser(Tool):
    """Send a message to the user (executed in Python backend)."""

    def __init__(
        self,
        content: str = "",
        citations: List[Any] = None,
        content_blocks: List[Dict[str, Any]] = None,
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.content = content
        self.citations = citations or []
        self.content_blocks = content_blocks or []

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Tool completes immediately, returns content blocks (or legacy content + citations)
        # No UserInputException - this executes in Python
        if self.content_blocks:
            return json.dumps({'success': True, 'content_blocks': self.content_blocks})
        else:
            # Backward compatibility
            return json.dumps({'success': True, 'content': self.content, 'citations': self.citations})



# web_search is a server-side tool provided by Anthropic - no client-side implementation needed


# ============================================================================
# Phase 1: Unified File System API Tools
# ============================================================================

@register_agent
class ReadFiles(Tool):
    """Load files with their content, references, and cached query results.

    Returns each file as CompressedAugmentedFile: fileState, references, and queryResults
    as compressed GFM markdown tables.

    Chart images (for question files with a rendered chart) are returned as full-fidelity
    image blocks — they are never truncated.

    Text table data (queryResults[].data) is truncated at maxChars characters (default 10,000):
    - truncated: true means the result was cut short; totalRows shows the full row count.
    - Increase maxChars (up to 100,000) to see more rows in text form.
    - To page through rows, use ExecuteQuery with OFFSET in the SQL.
    - Set runQueries: false to skip query execution and load only file metadata.

    Only call this for files NOT already in AppState or AppState.references — calling it for
    files already in AppState is wasteful and redundant.
    """

    def __init__(
        self,
        fileIds: List[int] = Field(..., description="Array of file IDs to load"),
        maxChars: Optional[int] = Field(None, description="Max characters of table data per query result (default 10,000, max 100,000). Increase to see more rows."),
        runQueries: Optional[bool] = Field(None, description="Execute queries to include fresh data (default true). Set false to load file metadata only."),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.fileIds = fileIds
        self.maxChars = maxChars
        self.runQueries = runQueries

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Frontend tool - executes in browser with Redux access
        raise UserInputException(self._unique_id)


class EditChange(BaseModel):
    oldMatch: str = Field(..., description="String to search for in full file JSON")
    newMatch: str = Field(..., description="String to replace with")
    replaceAll: bool = Field(True, description="Replace ALL occurrences (true) or error if not unique (false)")


@register_agent
class EditFile(Tool):
    """Edit a file using an ordered list of string find-and-replace changes.

    Search for each oldMatch in the FULL file JSON and replace with newMatch.
    The file JSON includes: {"id": 123, "name": "...", "path": "...", "type": "question", "content": {...}}

    You can edit ANY field (name, path, or content) using this tool.

    Changes are applied sequentially in order — later entries can depend on earlier ones.
    All changes succeed or the batch fails: on failure the response includes `succeededCount`
    and `failedIndex` so you know exactly where to retry.

    On fail, you can retry with shortened oldMatch if applicable.

    Example — update query and viz in one call:
    EditFile(fileId=123, changes=[
        {"oldMatch": '"query":"SELECT 1"', "newMatch": '"query":"SELECT id, name FROM users"'},
        {"oldMatch": '"type":"table"', "newMatch": '"type":"bar"'}
    ])

    CRITICAL — query + parameters must stay in sync:
    If a change adds or removes :paramName tokens in the query, you MUST include a corresponding
    change to the parameters array in the same call. The frontend auto-syncs on user edit, but
    EditFile bypasses that — orphaned or missing parameters will cause query execution to fail.

    replaceAll behaviour (per change):
    - replaceAll=true (default): replace EVERY occurrence of oldMatch in the file JSON.
      Use this when renaming a column/table that appears in multiple places (SELECT, WHERE, GROUP BY, etc.).
    - replaceAll=false: replace only if oldMatch is unique. If it appears more than once the
      tool returns an error — add more surrounding context to oldMatch to make it unique, or
      switch back to replaceAll=true if you really want all occurrences replaced.

    Changes are staged as drafts in Redux. The user reviews and publishes all pending changes
    via the Publish All button. You do not need to call Navigate or PublishFile.

    String Matching: Use `oldMatch` copied directly from AppState content — never call ReadFiles just to get content that is already in AppState.
    """

    def __init__(
        self,
        fileId: int = Field(..., description="File ID to edit"),
        changes: List[EditChange] = Field(..., description=f"Ordered list of find-and-replace changes to apply sequentially. Schema for newMatch values: {ATLAS_FILE_SCHEMA_NO_VIZ_JSON}. For vizSettings, use the same schema as ExecuteQuery.vizSettings."),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.fileId = fileId
        self.changes = changes

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Frontend tool - executes in browser with Redux access
        raise UserInputException(self._unique_id)



@register_agent
class PublishAll(Tool):
    """Request the user to review and publish all unsaved changes.
    Opens a modal showing all draft files. If there are no unsaved changes,
    returns immediately. Otherwise blocks until user publishes or cancels.
    """

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Frontend tool - executes in browser with Redux access
        raise UserInputException(self._unique_id)


@register_agent
class CreateFile(Tool):
    """Create a new file of any type as a draft. No page navigation.

    Creates the file immediately with a real positive ID. The file is hidden from folder
    listings until the user publishes via the Save button or Publish All.

    - file_type: any supported type ('question', 'dashboard', 'report', etc.)
    - name: optional display name
    - path: folder path to create in (e.g. '/org/reports'). Defaults to user's home folder.
    - content: initial content fields merged on top of template defaults.
      Examples by type:
        question:  {"query": "SELECT 1", "connection_name": "default", "vizSettings": {...}}
        dashboard: {"description": "My dashboard"}

    Returns: {success: true, state: {fileState: {id, name, path, type, isDirty, content}, references: [...], queryResults: [...]}}
    The returned id is a real positive integer. Use it with EditFile or EditDashboard immediately.
    """

    def __init__(
        self,
        file_type: str = Field(..., description="File type to create: 'question', 'dashboard', 'report', etc."),
        name: Optional[str] = Field(None, description="Display name for the new file"),
        path: Optional[str] = Field(None, description="Folder path to create the file in (e.g. '/org/reports'). Defaults to user's home folder."),
        content: Optional[dict] = Field(None, description="Initial content fields merged on top of template defaults. Schema: same as the 'content' field in EditFile"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.file_type = file_type
        self.name = name
        self.path = path
        self.content = content

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        raise UserInputException(self._unique_id)


@register_agent
class ExecuteQuery(Tool):
    """Execute a standalone SQL query without modifying any files.

    Use this to run ad-hoc queries for data exploration.
    Results are cached but not associated with any question file.

    Returns a JSON object with:
    - data: GFM markdown containing the first shownRows rows of output
    - totalRows: total rows returned by the query
    - shownRows: number of rows included in the data field (may be < totalRows if output was large)
    - truncated: true when data was cut short (shownRows < totalRows)

    Chart images (when vizSettings is provided) are full-fidelity — never truncated.

    Text table data is truncated at maxChars characters (default 10,000):
    - Increase maxChars (up to 100,000) to expose more rows in text form.
    - To page through results, add OFFSET N to the SQL (e.g. SELECT … LIMIT 100 OFFSET 100).
    - When truncated is true, prefer narrowing the query (WHERE / LIMIT) over increasing maxChars.
    """

    def __init__(
        self,
        query: str = Field(..., description="SQL query to execute"),
        connectionId: str = Field(..., description="Database connection name"),
        parameters: Optional[Dict[str, Any]] = Field(None, description="Query parameters as key-value pairs"),
        vizSettings: Optional[str] = Field(None, description=f"settings to visualize the output of the query; schema: {vizSettingsJsonStr}"),
        maxChars: Optional[int] = Field(None, description="Max characters of table output (default 10,000, max 100,000). Increase to see more rows."),
        _schema: Optional[List[dict]] = None,
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.query = query
        self.connectionId = connectionId
        self.parameters = parameters or {}
        self.vizSettings = vizSettings
        self.maxChars = maxChars
        self._schema = _schema

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        if self._schema:
            error = validate_query_tables(self.query, self._schema)
            if error:
                return json.dumps({'success': False, 'error': error})
        # Backend tool - executes in Next.js API routes
        raise UserInputException(self._unique_id)


@register_agent
class SubmitBinary(Tool):
    """Submit a binary (yes/no) answer for an eval assertion.

    Use this tool when asked to answer a binary question during evaluation.
    Call this exactly once with your final answer.
    """

    def __init__(
        self,
        answer: bool = Field(..., description="True for yes/correct, False for no/incorrect"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.answer = answer

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        return json.dumps({'submitted': True, 'answer': bool(self.answer)})


@register_agent
class SubmitNumber(Tool):
    """Submit a numeric answer for a number_match eval assertion.

    Use this tool when asked to compute and submit a numeric value during evaluation.
    Call this exactly once with your final computed answer.
    """

    def __init__(
        self,
        answer: float = Field(..., description="Numeric answer to the eval question"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.answer = answer

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        return json.dumps({'submitted': True, 'answer': float(self.answer)})


@register_agent
class SubmitString(Tool):
    """Submit a string answer for a string_match eval assertion.

    Use this tool when asked to compute and submit a string value during evaluation.
    Call this exactly once with your final string answer.
    """

    def __init__(
        self,
        answer: str = Field(..., description="String answer to the eval question"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.answer = answer

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        return json.dumps({'submitted': True, 'answer': str(self.answer)})


@register_agent
class CannotAnswer(Tool):
    """Signal that the question cannot be answered with the available data.
    Call this if the data is insufficient or the question is unanswerable.
    """

    def __init__(
        self,
        reason: str = Field(..., description="Why the question cannot be answered"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.reason = reason

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        return json.dumps({'submitted': True, 'cannot_answer': True, 'reason': str(self.reason)})
