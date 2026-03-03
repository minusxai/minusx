"""Analyst Tools - executed by Next.js backend."""
from typing import Optional, List, Any, Dict
from tasks import Tool, UserInputException, register_agent
from pydantic import Field
import json

from tasks.agents.analyst.file_schema import (
    vizSettingsJsonStr, ATLAS_FILE_SCHEMA_JSON,
)

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
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.connection_id = connection_id
        self.query = query

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


@register_agent
class PresentFinalAnswer(Tool):
    """DEPRECATED: Use <thinking> and <answer> XML tags instead.

    This tool is kept for backwards compatibility with old conversation logs.
    New conversations should use XML tags directly in the model's response:
    - <thinking> tags for internal reasoning and exploration
    - <answer> tags for user-facing responses

    Present the final analysis to the user after completing all exploratory work.
    Use this tool to structure your final conclusions after running exploratory queries.
    This separates your working process from the final answer the user sees.

    **IMPORTANT**:
    - Call this AFTER completing all data exploration and analysis
    - Put your complete findings in this tool instead of writing long markdown responses
    - Use markdown formatting for the answer (headers, lists, bold, table, etc.)
    - Use Markdown table if you want to show results, instead of a list of items, especially if could use columns
    - End with a helpful message to continue the conversation like "What else would you like me to do?" or 
      "Would you like to see further slices on ColumnB?" etc.
    """

    def __init__(
        self,
        answer: str = Field(..., description="The final answer in markdown format with your complete analysis, insights, and conclusions"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.answer = answer

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Signal that this tool needs frontend execution for special rendering
        raise UserInputException(self._unique_id)
    

# web_search is a server-side tool provided by Anthropic - no client-side implementation needed


# ============================================================================
# Phase 1: Unified File System API Tools
# ============================================================================

@register_agent
class ReadFiles(Tool):
    """Load multiple files with their full JSON representation.

    Returns each file as complete JSON: {"id": 123, "name": "...", "path": "...", "type": "question", "content": {...}}

    Use this to:
    - Read file content before editing (see full structure including name, path, content)
    - Inspect multiple files at once
    - Get file metadata and content in one call

    The response includes file states, references, and cached query results.

    Only call this for files NOT already in AppState or AppState.references — calling it for files already in AppState is wasteful and redundant.
    """

    def __init__(
        self,
        fileIds: List[int] = Field(..., description="Array of file IDs to load"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.fileIds = fileIds

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Frontend tool - executes in browser with Redux access
        raise UserInputException(self._unique_id)


@register_agent
class EditFile(Tool):
    """Edit a file using string find-and-replace.

    Search for oldMatch in the FULL file JSON and replace with newMatch.
    The file JSON includes: {"id": 123, "name": "...", "path": "...", "type": "question", "content": {...}}

    You can edit ANY field (name, path, or content) using this tool.
    Examples:
    - Change name: oldMatch='"name":"Old Name"', newMatch='"name":"New Name"'
    - Change query: oldMatch='"query":"SELECT 1"', newMatch='"query":"SELECT * FROM users"'
    - Change description: oldMatch='"description":"Old"', newMatch='"description":"Updated"'
    - Add a parameter: oldMatch='"query":"SELECT * FROM t"', newMatch='"query":"SELECT * FROM t WHERE id = :user_id","parameters":[{"name":"user_id","type":"number"}]'

    CRITICAL — query + parameters must stay in sync:
    If your newMatch adds or removes :paramName tokens in the query, you MUST update the
    parameters array in the same newMatch. The frontend auto-syncs on user edit, but EditFile
    bypasses that — orphaned or missing parameters will cause query execution to fail.

    The tool validates changes and returns a diff.
    Changes are staged as drafts in Redux. The user reviews and publishes all pending changes
    via the Publish All button. You do not need to call Navigate or PublishFile.

    String Matching: Use `oldMatch` copied directly from AppState content — never call ReadFiles just to get content that is already in AppState.
    """

    def __init__(
        self,
        fileId: int = Field(..., description="File ID to edit"),
        oldMatch: str = Field(..., description="String to search for in full file JSON (including name, path, content)"),
        newMatch: str = Field(..., description=f"String to replace with. File JSON schema: {ATLAS_FILE_SCHEMA_JSON}"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.fileId = fileId
        self.oldMatch = oldMatch
        self.newMatch = newMatch

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
    """Create a new file (question or dashboard).

    Behavior depends on file_type:
    - Creating a *question* → question is created as a draft (virtual ID, negative number).
      No page navigation, no modal. Returns virtualId.
      Use virtualId directly with EditDashboard to add it to a dashboard:
        EditDashboard(operation="add_existing_question", question_id=<virtualId>, file_id=<dashboardId>)
      Changes are staged until the user publishes.
    - Creating a *dashboard*, or any file from a folder → navigates to the new file page.
    """

    def __init__(
        self,
        file_type: str = Field(..., description="File type to create: 'question' or 'dashboard'"),
        name: Optional[str] = Field(None, description="Display name for the new file"),
        query: Optional[str] = Field(None, description="Initial SQL query (questions only)"),
        database_name: Optional[str] = Field(None, description="Database connection name (questions only)"),
        viz_settings: Optional[dict] = Field(None, description="Initial visualization settings (questions only)"),
        folder: Optional[str] = Field(None, description="Folder path to create the file in"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.file_type = file_type
        self.name = name
        self.query = query
        self.database_name = database_name
        self.viz_settings = viz_settings
        self.folder = folder

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        raise UserInputException(self._unique_id)


@register_agent
class SetRuntimeValues(Tool):
    """Set ephemeral runtime values on a file (question or dashboard).

    Currently supports setting parameter values. These are runtime-only (not persisted to file content)
    and trigger re-execution of queries with the new values.

    Works for both questions and dashboards:
    - Question: sets parameter values and re-executes the query
    - Dashboard: sets merged parameter values across all dashboard questions and re-executes them

    Parameters:
    - fileId: The file ID (question or dashboard) to set values on
    - parameter_values: Dict of {paramName: value} to set (e.g., {"start_date": "2024-01-01", "limit": 100})
    """

    def __init__(
        self,
        fileId: int = Field(..., description="Target file ID (question or dashboard)"),
        parameter_values: dict = Field(..., description="Dict of parameter values to set: {paramName: value}"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.fileId = fileId
        self.parameter_values = parameter_values

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Frontend tool - executes in browser with Redux access
        raise UserInputException(self._unique_id)


@register_agent
class ExecuteQuery(Tool):
    """Execute a standalone SQL query without modifying any files.

    Use this to run ad-hoc queries for data exploration.
    Results are cached but not associated with any question file.
    """

    def __init__(
        self,
        query: str = Field(..., description="SQL query to execute"),
        connectionId: str = Field(..., description="Database connection name"),
        parameters: Optional[Dict[str, Any]] = Field(None, description="Query parameters as key-value pairs"),
        vizSettings: Optional[str] = Field(None, description=f"settings to visualize the output of the query; schema: {vizSettingsJsonStr}"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.query = query
        self.connectionId = connectionId
        self.parameters = parameters or {}
        self.vizSettings = vizSettings

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Backend tool - executes in Next.js API routes
        raise UserInputException(self._unique_id)
