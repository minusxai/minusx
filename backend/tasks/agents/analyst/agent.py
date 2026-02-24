"""MinusX Analyst Agent - LLM-powered SQL analyst."""

import json
import os
from datetime import datetime, timezone
from typing import List, Optional
import httpx
import time
from tasks import Agent, register_agent, AgentCall, UserInputException
from tasks.chat_thread_processor import root_tasks_to_thread, task_batch_to_thread, tool_calls_to_agent_calls
from tasks.llm.client import allm_request as real_allm_request, describe_tool
from tasks.llm.models import ALLMRequest, LlmSettings, UserInfo
from tasks.llm.config import ANALYST_V2_MODEL, MAX_STEPS_LOWER_LEVEL
from .tools import ExecuteSQLQuery, SearchDBSchema, EditDashboard, EditReport, GetAllQuestions, SearchFiles, GetFiles, UpdateFileMetadata, Clarify, Navigate, CreateFile
from .tools import ReadFiles, EditFile, ExecuteQuery, SetRuntimeValues  # native toolset
from .prompt_loader import get_prompt


# Mock LLM request if LLM_MOCK_URL is set (for testing)
async def allm_request(request: ALLMRequest, on_content=None):
    """Call real LLM or mock server based on environment variable."""
    mock_url = os.getenv('LLM_MOCK_URL')

    if not mock_url:
        # Use real LLM
        return await real_allm_request(request, on_content)

    # Use mock server for testing
    async with httpx.AsyncClient() as client:
        # Convert request to JSON-serializable format
        llm_settings = request.llmSettings
        if llm_settings and hasattr(llm_settings, 'model_dump'):
            llm_settings = llm_settings.model_dump()

        # Convert Tool classes to JSON schema format
        tools = request.tools if request.tools else []
        tool_descriptions = [describe_tool(tool) for tool in tools]

        request_data = {
            "messages": request.messages,
            "llmSettings": llm_settings or {},
            "tools": tool_descriptions
        }

        # Call mock server
        response = await client.post(
            f"{mock_url}/mock/llm",
            json=request_data,
            timeout=30.0
        )

        if response.status_code != 200:
            error_data = response.json()
            raise Exception(f"LLM mock server error: {error_data.get('error', 'Unknown error')}")

        data = response.json()
        return (data['response'], data['usage'])


@register_agent
class AnalystAgent(Agent):
    """
    Analyst Agent that answers user questions by executing SQL queries.
    Uses LLM to decide which tools to call (ExecuteSQLQuery, SearchDBSchema).
    Tools are executed by Next.js backend.
    """

    def __init__(
        self,
        goal: str,
        connection_id: Optional[str] = None,
        schema: Optional[List[dict]] = None,
        context: Optional[str] = None,
        app_state: Optional[dict] = None,
        home_folder: Optional[str] = None,
        city: Optional[str] = None,
        agent_name: Optional[str] = None,
        toolset: str = 'classic',
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.goal = goal
        self.connection_id = connection_id or "No connection"
        self.schema = schema or []
        self.context = context or ""
        self.app_state = app_state or {}
        self.agent_name = agent_name or "MinusX"
        self.home_folder = home_folder or "/"
        self.city = city
        self.toolset = toolset
        self.tool_thread: List[dict] = []  # Conversation thread with tool calls/responses
        self.child_count = 0

    async def reduce(self, child_batches):
        """Process completed child tasks and update conversation thread."""
        # Only process NEW batches since last reduce call
        new_batches = child_batches[self.child_count:]
        for batch in new_batches:
            self.tool_thread.extend(task_batch_to_thread([batch]))

        self.child_count = len(child_batches)

    def _get_system_message(self) -> dict:
        """Generate system message with schema and context."""
        max_steps = MAX_STEPS_LOWER_LEVEL - 5  # Safety margin

        content = get_prompt(
            f'{self.toolset}.system',
            schema=self.schema,
            context=self.context,
            connection_id=self.connection_id,
            home_folder=self.home_folder,
            max_steps=max_steps,
            agent_name=self.agent_name
        )
        return {"role": "system", "content": content}

    def _get_user_message(self) -> dict:
        """Generate user message with the goal and app state."""
        app_state_str = json.dumps(self.app_state, indent=2) if self.app_state else "null"

        content = get_prompt(
            f'{self.toolset}.user',
            app_state=app_state_str,
            goal=self.goal,
            current_time=time.strftime("%Y-%m-%d %H:%M:%S")
        )
        return {"role": "user", "content": content}

    def _get_available_tools(self):
        """Get list of tools available to this agent."""
        if len(self.tool_thread) >= MAX_STEPS_LOWER_LEVEL - 5:
            return []

        if self.toolset == 'native':
            return [ReadFiles, EditFile, ExecuteQuery, SetRuntimeValues, Navigate, Clarify, SearchDBSchema, SearchFiles, CreateFile]

        # classic (default)
        return [ExecuteSQLQuery, SearchDBSchema, SearchFiles, GetFiles, UpdateFileMetadata, Navigate, Clarify, EditDashboard, EditReport, GetAllQuestions, CreateFile]
    
    def _get_history(self):
        previous_root_tasks = self._orchestrator.get_previous_root_tasks()
        previous_root_tasks.reverse()
        return root_tasks_to_thread(previous_root_tasks, self._orchestrator)

    async def run(self) -> dict:
        """Main execution loop for the agent."""
        thread_history = self._get_history()
        base_messages = [self._get_system_message()] + thread_history + [self._get_user_message()]

        # Run LLM loop
        while len(self.tool_thread) < MAX_STEPS_LOWER_LEVEL:
            messages = base_messages + self.tool_thread
            available_tools = self._get_available_tools()

            # Call LLM
            llm_settings = LlmSettings(
                model=ANALYST_V2_MODEL,
                response_format={"type": "text"},
                tool_choice="auto",
                include_web_search=True
            )

            response, _ = await allm_request(
                ALLMRequest(
                    messages=messages,
                    llmSettings=llm_settings,
                    tools=available_tools,
                    userInfo=UserInfo(city=self.city) if self.city else None
                ),
                on_content=self._orchestrator.onContent if self._orchestrator else None
            )

            # Process LLM response
            tool_calls = response.get("tool_calls", [])
            content = response.get("content", "")
            citations = response.get("citations", [])
            content_blocks = response.get("content_blocks", None)
            agent_calls = tool_calls_to_agent_calls(tool_calls, content, citations, content_blocks)
            finish_reason = response.get("finish_reason", "")
            

            # If LLM finished with content (no more tool calls), return result
            if finish_reason == "stop":
                response = {
                    "success": True
                }
                if content:
                    response["content"] = content
                    response["citations"] = citations
                return response

            # Convert tool calls to AgentCalls and dispatch
            if agent_calls:
                await self.dispatch(agent_calls)

        # Hit max iterations
        return {
            "success": False,
            "content": f"Maximum iterations ({MAX_STEPS_LOWER_LEVEL}) reached. Please try a simpler query."
        }


@register_agent
class ReportAgent(Agent):
    """
    Report Agent that runs report analyses and generates a summary.

    Flow:
    1. Dispatch AnalystAgent for each reference (question/dashboard)
    2. Collect results from child agents via reduce()
    3. Use LLM to synthesize all outputs into a final report
    4. Return the generated report with embedded query references
    """

    def __init__(
        self,
        report_id: int,
        report_name: str = "Untitled Report",
        references: Optional[List[dict]] = None,
        report_prompt: str = "",
        emails: Optional[List[str]] = None,
        # Global context for analyst agents
        connection_id: Optional[str] = None,
        schema: Optional[List[dict]] = None,
        context: Optional[str] = None,
        home_folder: Optional[str] = None,
        **kwargs
    ):
        super().__init__(**kwargs)  # type: ignore
        self.report_id = report_id
        self.report_name = report_name
        self.references = references or []
        self.report_prompt = report_prompt
        self.emails = emails or []
        # Global context
        self.connection_id = connection_id
        self.schema = schema or []
        self.context = context or ""
        self.home_folder = home_folder or "/"
        # Track child results
        self.child_results: List[dict] = []
        # Track query results from ExecuteSQLQuery tool calls
        self.queries: dict = {}
        self.started_at = datetime.now(timezone.utc).isoformat()

    def _collect_queries_from_task(self, task, reference_info: Optional[dict] = None):
        """Recursively collect ExecuteSQLQuery results from a task and its children."""
        # Check if this is an ExecuteSQLQuery tool call with successful result
        if task.agent == 'ExecuteSQLQuery' and task.result:
            result = task.result
            args = task.args

            # Parse result (may be string or dict)
            parsed_result = result
            if isinstance(result, str):
                try:
                    parsed_result = json.loads(result)
                except (json.JSONDecodeError, TypeError):
                    parsed_result = {}

            # Only store successful queries with data
            if parsed_result.get('success') and parsed_result.get('columns'):
                # Parse vizSettings from args
                viz_settings = {'type': 'table'}
                if args.get('vizSettings'):
                    if isinstance(args['vizSettings'], str):
                        try:
                            viz_settings = json.loads(args['vizSettings'])
                        except (json.JSONDecodeError, TypeError):
                            pass
                    elif isinstance(args['vizSettings'], dict):
                        viz_settings = args['vizSettings']

                self.queries[task.unique_id] = {
                    'query': args.get('query', ''),
                    'columns': parsed_result.get('columns', []),
                    'types': parsed_result.get('types', []),
                    'rows': parsed_result.get('rows', []),
                    'vizSettings': viz_settings,
                    'connectionId': args.get('connection_id'),
                    'fileId': reference_info.get('file_id') if reference_info else None,
                    'fileName': reference_info.get('file_name') if reference_info else None,
                }

        # Recursively check child tasks
        if hasattr(task, 'child_unique_ids'):
            for child_group in task.child_unique_ids:
                for child_id in child_group:
                    child_task = self._orchestrator.compressed.tasks.get(child_id)
                    if child_task:
                        self._collect_queries_from_task(child_task, reference_info)

    async def reduce(self, child_batches):
        """Collect results from child AnalystAgent tasks and extract query results."""
        for i, batch in enumerate(child_batches):
            # Get reference info for this batch
            reference_info = None
            if i < len(self.references):
                ref = self.references[i]
                reference_info = {
                    'file_id': ref.get('reference', {}).get('id'),
                    'file_name': ref.get('file_name', f'Reference {i+1}')
                }

            for task in batch:
                # Collect query results recursively from this task tree
                self._collect_queries_from_task(task, reference_info)

                # Extract result from completed task
                if hasattr(task, 'result') and task.result:
                    self.child_results.append({
                        'unique_id': task.unique_id if hasattr(task, 'unique_id') else None,
                        'result': task.result
                    })

    async def run(self) -> dict:
        """Execute the report by dispatching analyst agents and synthesizing results."""
        try:
            # Phase 1: Dispatch AnalystAgent for each reference
            if self.references and not self.child_results:
                agent_calls = []
                for i, ref in enumerate(self.references):
                    prompt = ref.get("prompt", "Analyze this data")
                    file_name = ref.get("file_name", f"Reference {i+1}")
                    ref_connection_id = ref.get("connection_id") or self.connection_id
                    # Use app_state directly from frontend (already enriched)
                    app_state = ref.get("app_state", {})

                    # Build goal with explicit instructions to execute query from app_state
                    # The app_state contains the SQL query - agent should run it with foreground=false
                    goal = f"""[{file_name}]{prompt}

IMPORTANT: Use foreground=false for ALL ExecuteSQLQuery calls - this is a background report execution. Use this to execute SQL queries from the app_state, or any other necessary query."""

                    # Create analyst agent call using AgentCall pattern
                    agent_calls.append(
                        AgentCall(
                            agent="AnalystAgent",
                            args={
                                "goal": goal,
                                "connection_id": ref_connection_id,
                                "schema": self.schema,
                                "context": self.context,
                                "app_state": app_state,
                                "home_folder": self.home_folder,
                                "agent_name": "ReportAnalyst"
                            }
                        )
                    )

                if agent_calls:
                    await self.dispatch(agent_calls)
                    return None  # Wait for children to complete

            # Phase 2: All children completed - synthesize results
            report_content = await self._synthesize_report()
            completed_at = datetime.now(timezone.utc).isoformat()

            return {
                "success": True,
                "content": f"Report '{self.report_name}' executed successfully.",
                "run": {
                    "reportId": self.report_id,
                    "reportName": self.report_name,
                    "startedAt": self.started_at,
                    "completedAt": completed_at,
                    "status": "success",
                    "steps": [{"name": "analysis", "outputs": len(self.child_results)}],
                    "generatedReport": report_content,
                    "queries": self.queries,  # Include collected query results
                    "error": None
                }
            }

        except UserInputException:
            # Re-raise to let orchestrator handle pending tool calls
            raise
        except Exception as e:
            completed_at = datetime.now(timezone.utc).isoformat()
            return {
                "success": False,
                "content": f"Report execution failed: {str(e)}",
                "run": {
                    "reportId": self.report_id,
                    "reportName": self.report_name,
                    "startedAt": self.started_at,
                    "completedAt": completed_at,
                    "status": "failed",
                    "steps": [],
                    "generatedReport": None,
                    "error": str(e)
                }
            }

    async def _synthesize_report(self) -> str:
        """Use LLM to synthesize child results into final report."""
        # Build analysis summaries from child results
        analyses = []
        for i, ref in enumerate(self.references):
            file_name = ref.get("file_name", f"Reference {i+1}")
            prompt = ref.get("prompt", "")

            # Find matching child result
            child_result = self.child_results[i] if i < len(self.child_results) else None
            result_content = ""
            if child_result and child_result.get("result"):
                result = child_result["result"]
                if isinstance(result, dict):
                    result_content = result.get("content", str(result))
                else:
                    result_content = str(result)

            analyses.append({
                "name": file_name,
                "prompt": prompt,
                "analysis": result_content
            })

        # Build synthesis prompt
        analyses_text = "\n\n".join([
            f"### {a['name']}\n**Prompt:** {a['prompt']}\n**Analysis:**\n{a['analysis']}"
            for a in analyses
        ])

        # Build available queries section for LLM
        queries_text = ""
        if self.queries:
            query_descriptions = []
            for tool_call_id, query_data in self.queries.items():
                query_name = query_data.get('fileName') or 'Query'
                query_sql = query_data.get('query', '')[:100]  # Truncate for prompt
                row_count = len(query_data.get('rows', []))
                viz_type = query_data.get('vizSettings', {}).get('type', 'table')
                query_descriptions.append(
                    f"- `{{{{query:{tool_call_id}}}}}`: {query_name} ({row_count} rows, {viz_type}) - `{query_sql}...`"
                )
            queries_text = "\n".join(query_descriptions)

        synthesis_prompt = f"""You are generating a report based on multiple data analyses.

## Report: {self.report_name}

## Individual Analyses:
{analyses_text}

## Available Interactive Charts
You can embed interactive charts in your report using the syntax `{{{{query:TOOL_CALL_ID}}}}`.
When you embed a chart, the frontend will render an interactive visualization that users can explore.

Available queries:
{queries_text or "No queries available"}

**IMPORTANT**: Use `{{{{query:ID}}}}` syntax to embed charts inline in your report. This will render as an interactive visualization.
Example: "Here's the revenue breakdown: {{{{query:mxgen_abc123}}}}"

## Synthesis Instructions:
{self.report_prompt or "Synthesize the analyses into a coherent executive summary. Highlight key findings, trends, and actionable insights."}

## Your Task:
Generate a well-structured markdown report that synthesizes all the analyses above. Include:
1. An executive summary
2. Key findings from each analysis with embedded charts where appropriate
3. Overall insights and recommendations

Format as clean markdown. Use the `{{{{query:ID}}}}` syntax to embed relevant charts inline."""

        # Call LLM for synthesis
        llm_settings = LlmSettings(
            model=ANALYST_V2_MODEL,
            response_format={"type": "text"}
        )

        response, _ = await allm_request(
            ALLMRequest(
                messages=[
                    {"role": "system", "content": "You are an expert report writer who synthesizes data analyses into clear, actionable reports."},
                    {"role": "user", "content": synthesis_prompt}
                ],
                llmSettings=llm_settings,
                tools=[]
            )
        )

        report_content = response.get("content", "")

        # Add header and footer
        final_report = f"""# {self.report_name}

*Generated at {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}*

{report_content}
"""

        if self.emails:
            final_report += f"\n---\n*This report will be sent to: {', '.join(self.emails)}*"

        return final_report
