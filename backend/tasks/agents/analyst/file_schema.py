"""Pydantic schemas for Atlas file types (question, dashboard).

Standalone module — only imports from pydantic and stdlib.
Imported by tools.py to embed JSON schema in EditFile field descriptions.
"""
from typing import Optional, List, Any, Dict, Union, Literal
from enum import Enum
from pydantic import BaseModel, Field, TypeAdapter
from typing import Annotated
import json


# ============================================================================
# Visualization Settings (moved verbatim from tools.py)
# ============================================================================

class VisualizationType(str, Enum):
    TABLE = "table"
    BAR = "bar"
    LINE = "line"
    SCATTER = "scatter"
    AREA = "area"
    FUNNEL = "funnel"
    PIE = "pie"
    PIVOT = "pivot"
    TREND = "trend"
    WATERFALL = "waterfall"
    COMBO = "combo"

class AggregationFunction(str, Enum):
    SUM = "SUM"
    AVG = "AVG"
    COUNT = "COUNT"
    MIN = "MIN"
    MAX = "MAX"

class FormulaOperator(str, Enum):
    ADD = "+"
    SUBTRACT = "-"
    MULTIPLY = "*"
    DIVIDE = "/"

class PivotValueConfig(BaseModel):
    """A measure column with its aggregation function."""
    column: str = Field(..., description="column name for the measure")
    aggFunction: AggregationFunction = Field(AggregationFunction.SUM, description="aggregation function to apply (SUM, AVG, COUNT, MIN, MAX)")

class PivotFormula(BaseModel):
    """A derived row/column computed from two dimension values at a given level."""
    name: str = Field(..., description="display label, e.g. 'YoY Change'")
    operandA: str = Field(..., description="dimension value, e.g. '2024'")
    operandB: str = Field(..., description="dimension value, e.g. '2023'")
    operator: FormulaOperator = Field(..., description="arithmetic operator: +, -, *, /")
    dimensionLevel: Optional[int] = Field(None, description="which dimension level to match (0=top-level, 1=second level, etc.). Defaults to 0.")
    parentValues: Optional[List[str]] = Field(None, description="parent dimension values to scope the formula when dimensionLevel > 0, e.g. ['PnL'] means only match within the PnL group")

class PivotConfig(BaseModel):
    """Configuration for pivot table visualization."""
    rows: List[str] = Field(..., description="dimension columns for row headers")
    columns: List[str] = Field(..., description="dimension columns for column headers")
    values: List[PivotValueConfig] = Field(..., description="measures with per-value aggregation functions")
    showRowTotals: Optional[bool] = Field(None, description="show row totals column")
    showColumnTotals: Optional[bool] = Field(None, description="show column totals row")
    showHeatmap: Optional[bool] = Field(None, description="show heatmap conditional formatting")
    rowFormulas: Optional[List[PivotFormula]] = Field(None, description="formulas combining top-level row dimension values")
    columnFormulas: Optional[List[PivotFormula]] = Field(None, description="formulas combining top-level column dimension values")

class AxisScale(str, Enum):
    LINEAR = "linear"
    LOG = "log"

class AxisConfig(BaseModel):
    """Per-axis configuration for scale type and range."""
    xScale: Optional[AxisScale] = Field(None, description="X-axis scale type: 'linear' (default) or 'log'")
    yScale: Optional[AxisScale] = Field(None, description="Y-axis scale type: 'linear' (default) or 'log'")
    xMin: Optional[float] = Field(None, description="explicit X-axis minimum value")
    xMax: Optional[float] = Field(None, description="explicit X-axis maximum value")
    yMin: Optional[float] = Field(None, description="explicit Y-axis minimum value")
    yMax: Optional[float] = Field(None, description="explicit Y-axis maximum value")

class ColumnFormatConfig(BaseModel):
    """Per-column display formatting. Only set when the user explicitly asks to change formatting."""
    alias: Optional[str] = Field(None, description="display name override for the column header")
    decimalPoints: Optional[int] = Field(None, description="number of decimal places (0-4) for numeric columns")
    dateFormat: Optional[str] = Field(None, description="date display format: 'iso', 'us', 'eu', 'short', 'month-year', or 'year'")
    prefix: Optional[str] = Field(None, description="string to prepend to displayed values (e.g. '$', '€')")
    suffix: Optional[str] = Field(None, description="string to append to displayed values (e.g. '%', ' units', 'k')")

class VisualizationStyleConfig(BaseModel):
    """Shared visual styling controls for charts."""
    colors: Optional[Dict[str, str]] = Field(None, description="color overrides mapping series index to color key (e.g. {'0': 'danger', '2': 'warning'}).")
    opacity: Optional[float] = Field(None, description="series opacity from 0.1 to 1.0")
    markerSize: Optional[int] = Field(None, description="point marker size for charts that render markers, such as scatter and line")
    stacked: Optional[bool] = Field(None, description="whether bar and area series should be stacked. Defaults to true for those chart types.")

class VisualizationSettings(BaseModel):
    """visualization settings"""
    type: VisualizationType = Field(..., description="type of the visualization (default is table)")
    xCols: Optional[List[str]] = Field([], description="list of column names in the x axis (for non-pivot chart types)")
    yCols: Optional[List[str]] = Field([], description="list of column names in the y axis (for non-pivot chart types)")
    tooltipCols: Optional[List[str]] = Field([], description="additional columns to show in chart tooltips without changing grouping or series structure")
    pivotConfig: Optional[PivotConfig] = Field(None, description="pivot table configuration (only used when type is 'pivot')")
    columnFormats: Optional[Dict[str, ColumnFormatConfig]] = Field(None, description="per-column display formatting keyed by column name. Only set when user asks to rename columns, change decimal places, or change date format. Good defaults are applied automatically.")
    styleConfig: Optional[VisualizationStyleConfig] = Field(None, description="shared visual styling for the chart, such as colors, opacity, and marker size.")
    colors: Optional[Dict[str, str]] = Field(None, description="deprecated legacy color overrides. Use styleConfig.colors instead.")
    axisConfig: Optional[AxisConfig] = Field(None, description="axis configuration for scale type (linear or log). Only set when user explicitly requests log scale.")
    model_config = {
        "populate_by_name": True,
        "title": "VizSettings"
    }

vizSettingsJsonStr = json.dumps(VisualizationSettings.model_json_schema())


# ============================================================================
# Question Content
# ============================================================================

class ParameterType(str, Enum):
    TEXT = "text"
    NUMBER = "number"
    DATE = "date"

class ParameterSource(BaseModel):
    """Reference to another question whose output drives a parameter's dropdown values."""
    type: Literal["question"]
    id: int
    column: str

class QuestionParameter(BaseModel):
    name: str
    type: ParameterType
    label: Optional[str] = None
    source: Optional[ParameterSource] = None  # None = free text/number/date input (default)

class QuestionReference(BaseModel):
    """Composed question reference — lets this query use @alias as a CTE."""
    id: int
    alias: str

class QuestionContent(BaseModel):
    description: Optional[str] = None
    query: str = Field(..., description="SQL query string, may contain :paramName tokens")
    vizSettings: VisualizationSettings
    parameters: Optional[List[QuestionParameter]] = None
    parameterValues: Optional[Dict[str, Any]] = None
    database_name: str = Field(..., description="connection name (empty string if none)")
    references: Optional[List[QuestionReference]] = None


# ============================================================================
# Dashboard Content
# ============================================================================

class FileAssetRef(BaseModel):
    """A reference to another question embedded in the dashboard."""
    type: Literal['question']
    id: int
    model_config = {"title": "FileReference"}

class InlineAsset(BaseModel):
    """Inline content block (text, image, divider) — no external file."""
    type: Literal['text', 'image', 'divider']
    id: Optional[str] = None
    content: Optional[str] = None

AssetReference = Annotated[Union[FileAssetRef, InlineAsset], Field(discriminator='type')]

class DashboardLayoutItem(BaseModel):
    id: int  # question ID
    x: int
    y: int
    w: int = Field(..., ge=2, description="width in grid units (min 2)")
    h: int = Field(..., ge=2, description="height in grid units (min 2)")

class DashboardLayout(BaseModel):
    columns: Optional[int] = 12
    items: Optional[List[DashboardLayoutItem]] = None

class DashboardContent(BaseModel):
    description: Optional[str] = None
    assets: List[AssetReference] = Field(..., description="ordered list of questions in the dashboard")
    layout: Optional[DashboardLayout] = None
    parameterValues: Optional[Dict[str, Any]] = None


# ============================================================================
# Top-level discriminated file models
# ============================================================================

class AtlasQuestionFile(BaseModel):
    id: Optional[int] = None
    name: str
    path: str
    type: Literal['question']
    content: QuestionContent
    references: Optional[List[int]] = None  # file IDs this file references

class AtlasDashboardFile(BaseModel):
    id: Optional[int] = None
    name: str
    path: str
    type: Literal['dashboard']
    content: DashboardContent
    references: Optional[List[int]] = None

AtlasFile = Annotated[
    Union[AtlasQuestionFile, AtlasDashboardFile],
    Field(discriminator='type')
]
_atlas_file_adapter = TypeAdapter(AtlasFile)
ATLAS_FILE_SCHEMA_JSON = json.dumps(_atlas_file_adapter.json_schema())


# ============================================================================
# Unified Test types
# ============================================================================

class LLMSubject(BaseModel):
    type: Literal["llm"]
    prompt: str = Field(..., description="natural language question to ask the AI agent")
    context: Dict[str, Any] = Field(..., description="where to run the prompt: {type: 'explore'} or {type: 'file', file_id: N}")
    connection_id: Optional[str] = None

class QuerySubject(BaseModel):
    type: Literal["query"]
    question_id: int = Field(..., description="file ID of the question to execute")
    column: Optional[str] = Field(None, description="column to read (defaults to first column)")
    row: Optional[int] = Field(None, description="row index: 0=first (default), -1=last, etc.")

TestSubject = Annotated[Union[LLMSubject, QuerySubject], Field(discriminator="type")]

class ConstantValue(BaseModel):
    type: Literal["constant"]
    value: Union[str, float, bool]

class QueryValue(BaseModel):
    type: Literal["query"]
    question_id: int = Field(..., description="file ID of the question whose result is the expected value")
    column: Optional[str] = Field(None, description="column to read (defaults to first column)")
    row: Optional[int] = Field(None, description="row index: 0=first (default), -1=last, etc.")

TestValue = Annotated[Union[ConstantValue, QueryValue], Field(discriminator="type")]

class Test(BaseModel):
    type: Literal["llm", "query"]
    subject: TestSubject
    answerType: Literal["binary", "string", "number"]
    operator: Literal["~", "=", "<", ">", "<=", ">="]
    value: TestValue
    label: Optional[str] = Field(None, description="optional display name shown in run results")


# ============================================================================
# Transformation Content
# ============================================================================

class TransformOutput(BaseModel):
    schema_name: str = Field(..., description="target schema name in the warehouse")
    view: str = Field(..., description="view name to create or replace")

class Transform(BaseModel):
    question: int = Field(..., description="file ID of the source question")
    output: TransformOutput
    tests: Optional[List[Test]] = Field(None, description="tests to run after this transform executes")

class TransformationContent(BaseModel):
    description: Optional[str] = None
    transforms: List[Transform] = Field(default_factory=list, description="list of transforms to execute")
