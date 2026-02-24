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
    """A derived row/column computed from two top-level dimension values."""
    name: str = Field(..., description="display label, e.g. 'YoY Change'")
    operandA: str = Field(..., description="top-level dimension value, e.g. '2024'")
    operandB: str = Field(..., description="top-level dimension value, e.g. '2023'")
    operator: FormulaOperator = Field(..., description="arithmetic operator: +, -, *, /")

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

class ColumnFormatConfig(BaseModel):
    """Per-column display formatting. Only set when the user explicitly asks to change formatting."""
    alias: Optional[str] = Field(None, description="display name override for the column header")
    decimalPoints: Optional[int] = Field(None, description="number of decimal places (0-4) for numeric columns")
    dateFormat: Optional[str] = Field(None, description="date display format: 'iso', 'us', 'eu', 'short', 'month-year', or 'year'")

class VisualizationSettings(BaseModel):
    """visualization settings"""
    type: VisualizationType = Field(..., description="type of the visualization (default is table)")
    xCols: Optional[List[str]] = Field([], description="list of column names in the x axis (for non-pivot chart types)")
    yCols: Optional[List[str]] = Field([], description="list of column names in the y axis (for non-pivot chart types)")
    pivotConfig: Optional[PivotConfig] = Field(None, description="pivot table configuration (only used when type is 'pivot')")
    columnFormats: Optional[Dict[str, ColumnFormatConfig]] = Field(None, description="per-column display formatting keyed by column name. Only set when user asks to rename columns, change decimal places, or change date format. Good defaults are applied automatically.")
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

class QuestionParameter(BaseModel):
    name: str
    type: ParameterType
    label: Optional[str] = None
    defaultValue: Optional[Union[str, float]] = None

class QuestionReference(BaseModel):
    """Composed question reference — lets this query use @alias as a CTE."""
    id: int
    alias: str

class QuestionContent(BaseModel):
    description: Optional[str] = None
    query: str = Field(..., description="SQL query string, may contain :paramName tokens")
    vizSettings: VisualizationSettings
    parameters: Optional[List[QuestionParameter]] = None
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
    w: int = Field(..., ge=3, description="width in grid units (min 3)")
    h: int = Field(..., ge=3, description="height in grid units (min 3)")

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
