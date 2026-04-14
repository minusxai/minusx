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
    RADAR = "radar"
    GEO = "geo"

class GeoSubType(str, Enum):
    CHOROPLETH = "choropleth"
    POINTS = "points"
    LINES = "lines"
    HEATMAP = "heatmap"


# -- Shared base for all geo sub-types --
class GeoConfigBase(BaseModel):
    """Fields shared across all geo sub-types."""
    mapName: Optional[str] = Field(None, description="base GeoJSON map: 'world', 'us-states', 'india-states'")
    showTiles: Optional[bool] = Field(False, description="toggle OpenStreetMap tile layer")
    pinnedCenter: Optional[List[float]] = Field(None, description="pinned map center as [lat, lng]")
    pinnedZoom: Optional[int] = Field(None, description="pinned map zoom level")


class ChoroplethConfig(GeoConfigBase):
    """Choropleth — color-filled regions by value."""
    subType: Literal["choropleth"] = Field(..., description="geo visualization sub-type")
    regionCol: Optional[str] = Field(None, description="column matching GeoJSON feature names")
    valueCol: Optional[str] = Field(None, description="numeric value column for fill color")
    colorScale: Optional[str] = Field(None, description="color scale: 'green' (default), 'blue', 'red-yellow-green'")


class PointsConfig(GeoConfigBase):
    """Points — lat/lng markers with optional bubble sizing."""
    subType: Literal["points"] = Field(..., description="geo visualization sub-type")
    latCol: Optional[str] = Field(None, description="latitude column")
    lngCol: Optional[str] = Field(None, description="longitude column")
    valueCol: Optional[str] = Field(None, description="numeric value column for bubble sizing (optional)")
    minRadius: Optional[int] = Field(None, description="minimum circle radius in pixels (default 5, range 1-20)")


class LinesConfig(GeoConfigBase):
    """Lines — arc lines between origin/destination coordinate pairs."""
    subType: Literal["lines"] = Field(..., description="geo visualization sub-type")
    latCol: Optional[str] = Field(None, description="origin latitude column")
    lngCol: Optional[str] = Field(None, description="origin longitude column")
    latCol2: Optional[str] = Field(None, description="destination latitude column")
    lngCol2: Optional[str] = Field(None, description="destination longitude column")


class HeatmapConfig(GeoConfigBase):
    """Heatmap — density heatmap with optional intensity weighting."""
    subType: Literal["heatmap"] = Field(..., description="geo visualization sub-type")
    latCol: Optional[str] = Field(None, description="latitude column")
    lngCol: Optional[str] = Field(None, description="longitude column")
    valueCol: Optional[str] = Field(None, description="numeric intensity column (optional, defaults to 1)")
    colorScale: Optional[str] = Field(None, description="color scale: 'green' (default), 'blue', 'red-yellow-green'")


GeoConfig = Annotated[
    Union[ChoroplethConfig, PointsConfig, LinesConfig, HeatmapConfig],
    Field(discriminator="subType"),
]

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
    compact: Optional[bool] = Field(None, description="compact heatmap mode: hides cell values, shows only colored squares with tooltips, and uses smaller cells — like a GitHub contribution graph")
    heatmapScale: Optional[str] = Field(None, description="heatmap color scale: 'red-yellow-green' (default), 'green' (single-hue like GitHub), 'blue' (single-hue blue)")
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
    yTitle: Optional[str] = Field(None, description="optional Y-axis title override for charts with a single Y axis")
    dualAxis: Optional[bool] = Field(None, description="enable dual Y-axis mode. When true, yRightCols in VizSettings determines which columns go on the right axis.")

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

class ChartAnnotation(BaseModel):
    """A chart annotation anchored to an existing chart x value and series with a short text label."""
    x: Union[str, float] = Field(..., description="X-axis value to anchor the annotation to")
    series: Optional[str] = Field(None, description="series name to anchor the annotation to")
    text: str = Field(..., description="annotation label text")

class VisualizationSettings(BaseModel):
    """visualization settings"""
    type: VisualizationType = Field(..., description="type of the visualization (default is table)")
    xCols: Optional[List[str]] = Field([], description="list of column names in the x axis (for non-pivot chart types)")
    yCols: Optional[List[str]] = Field([], description="list of column names in the y axis (for non-pivot chart types). When dualAxis is enabled in axisConfig, these are the left-axis columns.")
    yRightCols: Optional[List[str]] = Field([], description="list of column names for the right Y axis (only used when axisConfig.dualAxis is true)")
    tooltipCols: Optional[List[str]] = Field([], description="additional columns to show in chart tooltips without changing grouping or series structure")
    pivotConfig: Optional[PivotConfig] = Field(None, description="pivot table configuration (only used when type is 'pivot')")
    columnFormats: Optional[Dict[str, ColumnFormatConfig]] = Field(None, description="per-column display formatting keyed by column name. Only set when user asks to rename columns, change decimal places, or change date format. Good defaults are applied automatically.")
    styleConfig: Optional[VisualizationStyleConfig] = Field(None, description="shared visual styling for the chart, such as colors, opacity, and marker size.")
    annotations: Optional[List[ChartAnnotation]] = Field(None, description="annotations for cartesian charts. Each annotation specifies x, series, and text.")
    colors: Optional[Dict[str, str]] = Field(None, description="deprecated legacy color overrides. Use styleConfig.colors instead.")
    axisConfig: Optional[AxisConfig] = Field(None, description="axis configuration for scale type (linear or log). Only set when user explicitly requests log scale.")
    geoConfig: Optional[GeoConfig] = Field(None, description="geo map configuration (only used when type is 'geo')")
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

class QuestionParameterSource(BaseModel):
    """Reference to another question whose output drives a parameter's dropdown values."""
    type: Literal["question"]
    id: int
    column: str

class SqlParameterSource(BaseModel):
    """Inline SQL query whose first column drives a parameter's dropdown values."""
    type: Literal["sql"]
    query: str

ParameterSource = Union[QuestionParameterSource, SqlParameterSource]

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
    connection_name: str = Field(..., description="connection name (empty string if none)")
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
    id: Union[int, str]  # question ID (int) or inline asset ID (str UUID)
    x: int
    y: int
    w: int = Field(..., ge=2, description="width in grid units (min 2)")
    h: int = Field(..., ge=1, description="height in grid units (min 1)")

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

# Variant with vizSettings definitions stripped out — used in EditFile so the
# LLM gets full question/dashboard structure without duplicating the viz schema
# that is already present in ExecuteQuery.vizSettings.
def _build_atlas_schema_no_viz() -> str:
    schema = _atlas_file_adapter.json_schema()
    defs = schema.get("$defs", {})
    # Remove all defs that exist in the VisualizationSettings sub-schema
    viz_sub_defs = set(json.loads(vizSettingsJsonStr).get("$defs", {}).keys())
    viz_defs_to_remove = viz_sub_defs | {"VisualizationSettings"}
    for key in viz_defs_to_remove:
        defs.pop(key, None)
    # Replace any $ref to VisualizationSettings with a prose note
    schema_str = json.dumps(schema)
    schema_str = schema_str.replace(
        '"$ref":"#/$defs/VisualizationSettings"',
        '"description":"vizSettings — see ExecuteQuery.vizSettings for schema","type":"object"'
    )
    return schema_str

ATLAS_FILE_SCHEMA_NO_VIZ_JSON = _build_atlas_schema_no_viz()


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
