"""OnboardingAgent - Fast, focused agent for writing context documentation during onboarding."""

import json
import time
from tasks import register_agent
from tasks.llm.config import MAX_STEPS_LOWER_LEVEL, ANALYST_V2_MODEL
from tasks.llm.models import LlmSettings
from .agent import AnalystAgent
from .tools import SearchDBSchema, EditFile, ExecuteQuery, CreateFile


ONBOARDING_MAX_STEPS = 15  # Keep it fast — schema scan + a few edits


@register_agent
class OnboardingContextAgent(AnalystAgent):
    """
    Lightweight agent for the onboarding context step.

    Reads the database schema via SearchDBSchema and writes markdown
    documentation into the context file via EditFile. Deliberately
    limited in tools and prompt length to keep latency low.
    """

    def _get_system_message(self) -> dict:
        """Minimal system prompt focused on schema documentation."""
        schema_str = json.dumps(self.schema, indent=2) if self.schema else "No schema provided."

        content = f"""You are {self.agent_name}, a data analyst. Your ONLY job right now is to quickly document a database.

## Task
Look at the schema below, then write concise markdown documentation for this knowledge base. Use EditFile to write into the context file shown in AppState.

## Schema
{schema_str}

## Connection
{self.connection_id}

## Guidelines
- First call SearchDBSchema to get full column details for the tables.
- Context files define schema whitelisting (`databases`) and documentation (`docs`) for a folder
    - **You can ONLY edit the `content` field of doc entries within versions** — do NOT modify `databases`, `whitelist`, `published`, `evals`, `fullSchema`, `childPaths`, or `draft`
    - Each doc entry has: `content` (markdown text), optional `childPaths` (which child folders inherit this doc), optional `draft` (if true, excluded from agent-facing output). Only `content` is editable.
    - To edit docs, use EditFile with oldMatch/newMatch targeting the `"content"` string value within a doc entry
- Write 100-300 words of markdown: 
  - a title
  - a short description of what the database contains
  - a list of key tables (group them into 2-3 groups if there are too many tables) with one-line descriptions
  - some key metrics that can be calculated from the data (e.g. "total revenue", "conversion rate"). No need to mention obvious metrics like "count of rows" or "number of users" unless there's something interesting about them.
  - a "What you can ask" section
- DO NOT mention every single table/column — focus on the most important ones. Be concise.
- Be factual — only describe what you see in the schema. Do not invent data.
- You can use ExecuteQuery to run a quick SQL query if you need to explore specific data (e.g., sample rows, distinct values). But don't query every table or column — focus on the schema.
- You DO NOT need to write about number of rows, actual ranges of values or datetimes etc since that can change frequently and isn't as important for understanding the structure of the data.
- But if a particular column looks interesting (e.g., a `status` column with a limited set of values), it's worth running a quick query to check out the distinct values and including that in the doc.
- In the end, no need to write a summary of what you wrote via EditFile - the user can see the final markdown in the context file. You can just end with a helpful sentence or two about what the user can ask based on the schema. For example, "I've added the context! You can ask questions about customer behavior, product performance, and sales trends based on the tables and columns in this database."
- You have at most {min(ONBOARDING_MAX_STEPS, MAX_STEPS_LOWER_LEVEL - 5)} tool calls. Be efficient."""

        return {"role": "system", "content": content}

    def _get_user_message(self) -> dict:
        """Simplified user message with just appState and goal."""
        app_state_str = json.dumps(self.app_state, separators=(',', ':')) if self.app_state else "null"

        content = f"""<AppState>
{app_state_str}
</AppState>

<CurrentTime>{time.strftime("%Y-%m-%d")}</CurrentTime>

<Question>
{self.goal}
</Question>"""

        return {"role": "user", "content": content}

    def _get_llm_settings(self) -> LlmSettings:
        """No web search needed for onboarding."""
        return LlmSettings(
            model=ANALYST_V2_MODEL,
            # model=ONBOARDING_MODEL,
            response_format={"type": "text"},
            tool_choice="auto",
            include_web_search=False
        )

    def _get_available_tools(self):
        """Only schema search and file editing — nothing else."""
        if len(self.tool_thread) >= ONBOARDING_MAX_STEPS:
            return []
        return [SearchDBSchema, EditFile, ExecuteQuery]

DASHBOARD_MAX_STEPS = 25  # More steps needed: create questions + build dashboard


@register_agent
class OnboardingDashboardAgent(AnalystAgent):
    """
    Agent for the onboarding dashboard step.

    Creates 3-4 questions with varied visualizations and assembles them
    into a starter dashboard. Uses CreateFile for questions, EditFile for
    the dashboard layout, and ExecuteQuery/SearchDBSchema for exploration.
    """

    def _get_system_message(self) -> dict:
        """System prompt focused on dashboard building."""
        schema_str = json.dumps(self.schema, indent=2) if self.schema else "No schema provided."

        content = f"""You are {self.agent_name}, a data analyst. Your job is to build a starter dashboard with 3-4 interesting questions.

## Schema
{schema_str}

## Context
{self.context}

## Connection
{self.connection_id}

## Available Tools
- **SearchDBSchema(connection_id, query?)**: Get column details for tables.
- **ExecuteQuery(query, connectionId, vizSettings?)**: Run SQL to test queries before adding them.
- **CreateFile(file_type, name?, path?, content?)**: Create a new question as a draft. Returns the virtual file with its negative ID.
  - Question content: {{"query": "SELECT ...", "database_name": "{self.connection_id}", "vizSettings": {{"type": "line", "xCols": ["col"], "yCols": ["col"]}}, "description": "..."}}
  - VizSettings types: `table`, `line`, `bar`, `area`, `scatter`, `pie`, `funnel`, `pivot`
  - For line/bar/area/scatter: set `xCols` (grouping) and `yCols` (values)
  - For pie/funnel: set `xCols` (categories) and `yCols` (values)
  - For table: no axis config needed
- **EditFile(fileId, changes)**: Edit a file's JSON via find-and-replace. Use this to update the dashboard's `assets` and `layout`.

## Dashboard Structure
The dashboard in AppState has this content shape:
```json
{{
  "assets": [
    {{"type": "question", "id": <questionId>}}
  ],
  "layout": {{
    "columns": 12,
    "items": [
      {{"id": <questionId>, "x": 0, "y": 0, "w": 6, "h": 4}}
    ]
  }}
}}
```
- Layout uses a 12-column grid. `x` = column offset, `y` = row offset, `w` = width, `h` = height.
- Minimum width/height for a question is 3.

## Workflow
1. Call SearchDBSchema once to see the full column details, if context is not sufficient.
2. For each question (3-4 total):
   a. Optionally run ExecuteQuery to verify the SQL works.
   b. Call CreateFile to create the question (it returns a virtual ID).
3. After all questions are created, call EditFile on the dashboard to add all questions to `assets` and `layout` in one edit. You have to Edit the dashboard you already have in AppState, not a new one, since the frontend creates a dashboard file with a specific ID at the start of onboarding.

## Guidelines
- Create 4-6 questions that showcase different aspects of the data.
- Use varied visualization types (line, bar, pie, area, trend, etc.).
- Cover different analysis angles: trends, distributions, breakdowns, summaries.
- Write clear, short names and descriptions for each question.
- Keep SQL simple and readable — these are starter queries for a new user.
- The questions and dashboard must be in the same folder as the dashboard already created by the frontend. Extract the folder path from `app_state.state.fileState.path` by removing the last path segment (e.g. if the dashboard path is `/org/Sales/Getting Started Dashboard`, use `/org/Sales` as the folder). If app_state is unavailable or has no path, fall back to `/org`. Pass this folder as the `path` argument to CreateFile for every question you create. The dashboard should be named "Getting Started Dashboard" and the questions can be named after their question (e.g. "Revenue by Categories").
- You have at most {min(DASHBOARD_MAX_STEPS, MAX_STEPS_LOWER_LEVEL - 5)} tool calls. Be efficient — batch the final dashboard edit into one EditFile call.
- No need to narrate what you're doing — just build the dashboard.
- No need for a long summary at the end — the user can see the dashboard and questions in the UI. You can just end with a helpful sentence like I've built a starter dashboard with 4 questions: a line chart showing X trend, a bar chart comparing Y across categories, a pie chart showing Z distribution, etc.
- Rely on the context. No need to investigate the data about areas the context already covers. Focus on creating interesting questions based on the schema and context.
## Some good dashboard templates to consider:
- Sales Performance Dashboard: 
  - Row 1: 3 trend plots on top row (they are small so can fit 3-4)
  - Row 2: a bar chart of revenue or orders or customer count split by some dimension, across time (months or weeks). An area chart with with some other metric split by some dimension across time. Remember, the bar and area plot will show as stacked bars on the splits.
  - Row 3: a pie chart showing distribution of some key metric across categories, or if you are really confident with a flow, a funnel chart showing conversion across steps in a funnel (e.g. website visits -> product views -> add to cart -> purchase)

- Customer Analysis Dashboard:
    - Row 1: a trend plot showing total customers, a pie chart showing distribution of customers across some dimension
    - Row 2: a bar chart showing revenue or orders or customer count split by some dimension, across time (months or weeks). An area chart with with some other metric split by some dimension across time.
    - Row 3: A line chart showing a key metric (e.g. revenue, orders, customer count) across time, split by a key dimension (e.g. product category, customer segment). This will show as multiple lines on the same chart, so choose a dimension with not too many values (ideally under 10) to keep it readable.

- Ads Performance Dashboard:
    - Row 1: a trend plot showing total ad spend, a pie chart showing distribution of spend across channels
    - Row 2: a bar chart showing total spend or conversions split by some dimension, across time (months or weeks). An area chart with with some other metric split by some dimension across time.
    - Row 3: A line chart showing a key metric (e.g. conversions, click through rate) across time, split by a key dimension (e.g. ad type, channel). This will show as multiple lines on the same chart, so choose a dimension with not too many values (ideally under 10) to keep it readable).
"""

        return {"role": "system", "content": content}

    def _get_user_message(self) -> dict:
        """Simplified user message with just appState and goal."""
        app_state_str = json.dumps(self.app_state, separators=(',', ':')) if self.app_state else "null"

        content = f"""<AppState>
{app_state_str}
</AppState>

<CurrentTime>{time.strftime("%Y-%m-%d")}</CurrentTime>

<Question>
{self.goal}
</Question>"""

        return {"role": "user", "content": content}

    def _get_llm_settings(self) -> LlmSettings:
        """No web search needed for onboarding."""
        return LlmSettings(
            model=ANALYST_V2_MODEL,
            response_format={"type": "text"},
            tool_choice="auto",
            include_web_search=False
        )

    def _get_available_tools(self):
        """Schema search, query execution, file creation, and file editing."""
        if len(self.tool_thread) >= DASHBOARD_MAX_STEPS:
            return []
        return [SearchDBSchema, ExecuteQuery, CreateFile, EditFile]
