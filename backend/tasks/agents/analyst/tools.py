"""Analyst Tools - executed by Next.js backend."""
from typing import Optional, List, Any, Dict
from tasks import Tool, UserInputException, register_agent
from pydantic import Field
import json

from tasks.agents.analyst.file_schema import (
    VisualizationType, AggregationFunction, FormulaOperator,
    PivotValueConfig, PivotFormula, PivotConfig,
    ColumnFormatConfig, VisualizationSettings,
    vizSettingsJsonStr, ATLAS_FILE_SCHEMA_JSON,
)

@register_agent
class ExecuteSQLQuery(Tool):
    """Execute a SQL query against the user's database.
    If in Question page, use foreground=true to update the question page UI.
    If query contains :paramName syntax, provide parameters array.

    Composed Questions (references parameter):
    - Use references to compose questions from other questions via @alias syntax
    - Example: references=[{"id": 123, "alias": "base_data"}] lets you write SELECT * FROM @base_data
    - Referenced questions become CTEs (Common Table Expressions) at execution time
    - Single-level only: Referenced questions cannot themselves have references
    - Same connection required: Only reference questions with matching connection_id
    - When using foreground=true, both query and references are saved to the question

    VizSettings is a JSON string representing VisualizationSettings model.
    Example1 (line chart):
    {
        "type": "line",
        "xCols": ["date"],
        "yCols": ["sales", "profit"]
    }
    Example2 (table):
    {
        "type": "table"
    }
    Example3 (bar chart):
    {
        "type": "bar",
        "xCols": ["category", "subcategory"],
        "yCols": ["revenue"]
    }
    Example4 (pivot table):
    {
        "type": "pivot",
        "pivotConfig": {
            "rows": ["region", "city"],
            "columns": ["year"],
            "values": [{"column": "revenue", "aggFunction": "SUM"}],
        }
    }
    Example5 (pivot with formula):
    {
        "type": "pivot",
        "pivotConfig": {
            "rows": ["product"],
            "columns": ["year"],
            "values": [{"column": "sales", "aggFunction": "SUM"}],
            "columnFormulas": [{"name": "YoY Change", "operandA": "2024", "operandB": "2023", "operator": "-"}]
        }
    }
    Viz Instructions by types:
    - table: no need of xCols or yCols
    - bar, line, scatter, area: first value of xCol is x axis, others are treated as dimensions/splits to the metrics. yCols are the various measures/metrics
    - funnel, pie: one xCols val and one yCols val are needed. xCols value should be categories ideally
    - pivot: use pivotConfig instead of xCols/yCols. pivotConfig.rows are dimension columns for row headers, pivotConfig.columns are dimension columns for column headers, pivotConfig.values are measures with per-value aggregation functions (SUM/AVG/COUNT/MIN/MAX). Optional: rowFormulas/columnFormulas to compute derived rows/columns from top-level dimension values.
    - trend: the most recent yCols value is displayed (along with %change from last-but-one value)

    columnFormats (optional): Only set when the user explicitly asks to rename a column, change decimal places, or change date display format. Good defaults are applied automatically so you do not need to set this unless asked.
    Example: {"revenue": {"alias": "Sales", "decimalPoints": 2}, "order_date": {"dateFormat": "short"}}
    """

    def __init__(
        self,
        query: str = Field(..., description="the SQL query to execute"),
        connection_id: str = Field(..., description="the database connection ID to use"),
        vizSettings: Optional[str] = Field(None, description=f"settings to visualize the output of the query; schema: {vizSettingsJsonStr}"),
        foreground: bool = Field(False, description="if true, execute in foreground mode and update the current question page UI"),
        parameters: Optional[list] = Field(None, description='array of parameter objects with structure: {{"name": str, "type": "text"|"number"|"date", "label": str, "value": any}}. Use when query contains :paramName syntax'),
        references: Optional[list] = Field(None, description='array of question references for composed questions: [{{"id": int, "alias": str}}]. Use when query contains @alias syntax (e.g., SELECT * FROM @base_data)'),
        file_id: Optional[int] = Field(None, description="the file ID of the question to update (required if foreground is true). If this is not provided, the query will be executed in the background without updating any question."),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.query = query
        self.connection_id = connection_id
        self.vizSettings = vizSettings
        self.foreground = foreground
        self.parameters = parameters
        self.references = references
        self.file_id = file_id

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Signal that this tool needs Next.js backend execution
        raise UserInputException(self._unique_id)


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
class EditDashboard(Tool):
    """Edit dashboard content - add/remove questions, modify layout, or edit inline assets.
    EditDashboard Operations:
        1. add_existing_question: Add existing question by ID
            - Required: question_id (int)
            - Optional: layout_item (dict: {{id, x, y, w, h}})
            - Auto-places at bottom if no layout provided

        2. remove_question: Remove question from dashboard
            - Required: question_id (int)
            - Removes from both assets and layout

        3. update_layout: Reposition or resize question
            - Required: layout_item (dict: {{id, x, y, w, h}})
            - Check layout.columns in AppState for grid width (default is 12)
            - Validates x + w <= columns

        4. add_new_question: Create NEW question and add to dashboard
            - Required: questionName (str), query (str), database_name (str), vizSettings (dict)
            - Optional: description (str)
            - Question is created in dashboard's parent folder
            - Automatically added to dashboard if called from dashboard page

        5. update_question: Update existing question on dashboard
            - Required: question_id (int)
            - Optional: query (str), vizSettings (dict), parameters (list), references (list), questionName (str), description (str)
            - Updates the question file with new values
            - Only provided fields are updated (partial update)
            - parameters: Array of {"name": str, "type": "text"|"number"|"date", "label": str (optional), "value": any (optional)}
            - Use when query contains :paramName syntax (e.g., WHERE status = :status)
            - references: Array of {"id": int, "alias": str} for composed questions (see UpdateQuestion tool for details)
    """

    def __init__(
        self,
        file_id: int = Field(..., description="The dashboard file ID to edit"),
        operation: str = Field(..., description="Operation to perform: 'add_existing_question' | 'remove_question' | 'update_layout' | 'add_new_question' | 'update_question'"),
        question_id: Optional[int] = Field(None, description="ID of the question (required for add_existing_question, remove_question, update_question)"),
        layout_item: Optional[dict] = Field(None, description="Layout position/size object {id, x, y, w, h} for update_layout operation"),
        asset_id: Optional[str] = Field(None, description="Asset ID for text/image/divider operations"),
        text_content: Optional[str] = Field(None, description="Text content for text asset operations"),
        questionName: Optional[str] = Field(None, description="Name for the question (required for add_new_question, optional for update_question)"),
        query: Optional[str] = Field(None, description="SQL query (required for add_new_question, optional for update_question)"),
        database_name: Optional[str] = Field(None, description="Database connection name (required for add_new_question)"),
        vizSettings: Optional[dict] = Field(None, description="Visualization settings {type, xCols, yCols} or {type: 'pivot', pivotConfig: {rows, columns, values}} (required for add_new_question, optional for update_question)"),
        parameters: Optional[list] = Field(None, description='Query parameters array [{name, type, label?, value?}] for parameterized queries with :paramName syntax. (Optional)'),
        references: Optional[list] = Field(None, description='Question references for composed questions (optional): [{id: int, alias: str}]'),
        description: Optional[str] = Field(None, description="Description for the question, optional"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.file_id = file_id
        self.operation = operation
        self.question_id = question_id
        self.layout_item = layout_item
        self.asset_id = asset_id
        self.text_content = text_content
        self.questionName = questionName
        self.query = query
        self.database_name = database_name
        self.vizSettings = vizSettings
        self.parameters = parameters
        self.references = references
        self.description = description

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Signal that this tool needs frontend execution
        raise UserInputException(self._unique_id)


@register_agent
class EditReport(Tool):
    """Edit report configuration - schedule, references, prompts, and delivery settings.
    EditReport Operations:
        1. update_schedule: Update when the report runs
            - Required: schedule (dict: {{cron: str, timezone: str}})
            - cron: Cron expression (e.g., "0 9 * * 1" = Monday 9am)
            - timezone: IANA timezone (e.g., "America/New_York")

        2. add_reference: Add a question or dashboard to analyze
            - Required: reference_type ("question" | "dashboard"), reference_id (int), prompt (str)
            - reference_id: The file ID of the question or dashboard to add
            - prompt: What to ask about this data source

        3. remove_reference: Remove a question/dashboard from the report
            - Required: reference_id (int) - the file ID of the question/dashboard to remove

        4. update_reference: Update the prompt for a reference in the report
            - Required: reference_id (int), prompt (str)
            - reference_id: The file ID of the question/dashboard to update

        5. update_report_prompt: Update the overall synthesis instructions
            - Required: report_prompt (str)
            - This is how to combine analyses from all references into the final report

        6. update_emails: Update the delivery email list
            - Required: emails (list of str)
    """

    def __init__(
        self,
        file_id: int = Field(..., description="The report file ID to edit"),
        operation: str = Field(..., description="Operation: 'update_schedule' | 'add_reference' | 'remove_reference' | 'update_reference' | 'update_report_prompt' | 'update_emails'"),
        schedule: Optional[dict] = Field(None, description="Schedule object {cron: str, timezone: str} for update_schedule"),
        reference_type: Optional[str] = Field(None, description="Type of reference: 'question' or 'dashboard' (for add_question)"),
        reference_id: Optional[int] = Field(None, description="File ID of the question/dashboard to reference (for add_reference, remove_reference, update_reference)"),
        prompt: Optional[str] = Field(None, description="Prompt for what to analyze about this data (for add_question, update_question)"),
        report_prompt: Optional[str] = Field(None, description="Overall synthesis instructions (for update_report_prompt)"),
        emails: Optional[list] = Field(None, description="List of email addresses (for update_emails)"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.file_id = file_id
        self.operation = operation
        self.schedule = schedule
        self.reference_type = reference_type
        self.reference_id = reference_id
        self.prompt = prompt
        self.report_prompt = report_prompt
        self.emails = emails

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Signal that this tool needs frontend execution
        raise UserInputException(self._unique_id)


@register_agent
class EditAlert(Tool):
    """Edit alert configuration - monitored question, condition, schedule, and delivery.
    EditAlert Operations:
        1. update_schedule: Update when the alert checks
            - Required: schedule (dict: {{cron: str, timezone: str}})
            - cron: Cron expression (e.g., "0 9 * * 1" = Monday 9am)
            - timezone: IANA timezone (e.g., "America/New_York")

        2. update_question: Set which question to monitor
            - Required: question_id (int) - the file ID of the question

        3. update_condition: Update the alert condition
            - Required: condition (dict: {{selector: str, function: str, operator: str, threshold: number, column?: str}})
            - selector: "first" | "last" | "all" — which row(s) to evaluate
            - function: depends on selector
              - For "first"/"last": "value" | "diff" | "pct_change" | "months_ago" | "days_ago" | "years_ago"
                - value: raw numeric value from the selected row
                - diff: difference between selected row and adjacent row
                - pct_change: % change between selected row and adjacent row
                - months_ago/days_ago/years_ago: calendar distance from now (for freshness checks)
              - For "all": "count" | "sum" | "avg" | "min" | "max"
                - count: total number of rows (no column needed)
                - sum/avg/min/max: aggregate of all values in the column
            - operator: ">" | "<" | "=" | ">=" | "<=" | "!="
            - threshold: numeric threshold to compare against
            - column: required for all functions except "count"

        4. update_emails: Update the delivery email list
            - Required: emails (list of str) - email addresses to notify when alert triggers
    """

    def __init__(
        self,
        file_id: int = Field(..., description="The alert file ID to edit"),
        operation: str = Field(..., description="Operation: 'update_schedule' | 'update_question' | 'update_condition' | 'update_emails'"),
        schedule: Optional[dict] = Field(None, description="Schedule object {cron: str, timezone: str} for update_schedule"),
        question_id: Optional[int] = Field(None, description="Question file ID to monitor (for update_question)"),
        condition: Optional[dict] = Field(None, description="Condition object {selector, function, operator, threshold, column?} for update_condition"),
        emails: Optional[list] = Field(None, description="List of email addresses for update_emails"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.file_id = file_id
        self.operation = operation
        self.schedule = schedule
        self.question_id = question_id
        self.condition = condition
        self.emails = emails

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Signal that this tool needs frontend execution
        raise UserInputException(self._unique_id)


@register_agent
class GetAllQuestions(Tool):
    """Get all available questions that can be added to the dashboard.
        - Purpose: See all questions available to add to dashboard
        - Optional Parameters:
            - folder_path: Folder to search (use dashboard's parent folder from AppState.path)
            - search_query: Filter questions by name/description
            - exclude_ids: List of question IDs to exclude (e.g., already in dashboard)
        - Returns: List of questions with id, name, description, query, vizSettings, parameters
        - Usage: Call this FIRST to see what questions exist before adding to dashboard
        - Example: If dashboard is at "/org/sales-dashboard", search "/org" folder
    """

    def __init__(
        self,
        folder_path: Optional[str] = None,
        search_query: Optional[str] = None,
        exclude_ids: Optional[list] = None,
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.folder_path = folder_path
        self.search_query = search_query
        self.exclude_ids = exclude_ids or []

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
class GetFiles(Tool):
    """Load files by IDs with optional content retrieval.
    Efficiently loads multiple files at once. By default returns metadata only.
    - Purpose: Load full details of specific files after searching
    - Parameters:
        - ids (required): List of file IDs to load [1, 2, 3]
        - include_content (optional): true to load full content, false for metadata only
    - Returns: Complete file information including queries, visualizations, etc.
    - Example: GetFiles(ids=[42, 57], include_content=true)
    """

    def __init__(
        self,
        ids: List[int] = Field(..., description="List of file IDs to load"),
        include_content: bool = Field(False, description="Include full file content (default: false, metadata only)"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.ids = ids
        self.include_content = include_content

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Signal that this tool needs Next.js backend execution
        raise UserInputException(self._unique_id)


@register_agent
class UpdateFileMetadata(Tool):
    """Update current file's name, description, or path.

    Updates the current page's file (question or dashboard).
    Changes reflect immediately in the UI.

    Examples:
    - Rename: UpdateFileMetadata(file_id=123, name="Q4 Revenue Report")
    - Update description: UpdateFileMetadata(file_id=456, description="Sales analysis for Q4")
    - Both: UpdateFileMetadata(file_id=789, name="Q4 Revenue", description="Updated report")
    Note: At least one of name, description, or path must be provided.
    """

    def __init__(
        self,
        file_id: int = Field(..., description="The file ID to update"),
        name: Optional[str] = Field(None, description="New display name (optional)"),
        description: Optional[str] = Field(None, description="New description (optional)"),
        path: Optional[str] = Field(None, description="New full path (optional)"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.file_id = file_id
        self.name = name
        self.description = description
        self.path = path

    async def reduce(self, child_batches):
        pass

    async def run(self) -> str:
        # Validate that at least one field is provided
        if not self.name and not self.description and not self.path:
            return json.dumps({
                'success': False,
                'error': 'Must provide at least one of: name, description, or path'
            })

        # Signal that this tool needs frontend execution
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
class PublishFile(Tool):
    """Commit changes from Redux to the database.

    Saves the specified file and all dirty references in a single atomic transaction.
    Use this after EditFile to persist changes to disk.
    """

    def __init__(
        self,
        fileId: int = Field(..., description="File ID to publish (will cascade to dirty references)"),
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.fileId = fileId

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
