"""End-to-end tests for the Athena connector.

Uses moto to mock AWS services (Glue, S3, Athena) — no real AWS credentials required.

Tests verify:
1. Schema retrieval returns the expected tabular structure via Glue Data Catalog.
2. Query execution returns tabular data (list of dicts) without exceptions.
"""

import os
import pytest
import boto3
from moto import mock_aws
from sqlalchemy import text

# Set fake credentials before importing the connector so boto3 doesn't complain
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_SECURITY_TOKEN", "testing")
os.environ.setdefault("AWS_SESSION_TOKEN", "testing")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")

from connectors.athena_connector import AthenaConnector  # noqa: E402


REGION = "us-east-1"
S3_BUCKET = "test-athena-results"
S3_STAGING_DIR = f"s3://{S3_BUCKET}/results/"

BASE_CONFIG = {
    "aws_access_key_id": "testing",
    "aws_secret_access_key": "testing",
    "region_name": REGION,
    "s3_staging_dir": S3_STAGING_DIR,
    "schema_name": "default",
    "work_group": "primary",
}


# ---------------------------------------------------------------------------
# Test 1: Schema retrieval returns tabular structure
# ---------------------------------------------------------------------------

@mock_aws
def test_schema_retrieval_returns_tabular_data():
    """Schema retrieval via Glue should return the standard nested tabular structure."""
    # Set up Glue catalog with one database and one table
    glue = boto3.client("glue", region_name=REGION)
    glue.create_database(DatabaseInput={"Name": "sales"})
    glue.create_table(
        DatabaseName="sales",
        TableInput={
            "Name": "orders",
            "StorageDescriptor": {
                "Columns": [
                    {"Name": "order_id", "Type": "int"},
                    {"Name": "customer_name", "Type": "string"},
                    {"Name": "amount", "Type": "double"},
                ],
                "Location": f"s3://{S3_BUCKET}/sales/orders/",
                "InputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                "SerdeInfo": {
                    "SerializationLibrary": "org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe"
                },
            },
            "TableType": "EXTERNAL_TABLE",
        },
    )

    connector = AthenaConnector("test-conn", BASE_CONFIG)
    schema = connector.get_schema()

    # Top-level must be a non-empty list
    assert isinstance(schema, list), "Schema must be a list"
    assert len(schema) > 0, "Schema must not be empty"

    # Find our 'sales' schema entry
    sales_entry = next((s for s in schema if s["schema"] == "sales"), None)
    assert sales_entry is not None, "'sales' schema not found in result"

    # Tables must be a list
    assert isinstance(sales_entry["tables"], list)
    assert len(sales_entry["tables"]) == 1

    # Table entry structure
    orders_table = sales_entry["tables"][0]
    assert orders_table["table"] == "orders"
    assert isinstance(orders_table["columns"], list)
    assert len(orders_table["columns"]) == 3

    # Column structure: each column has name and type
    col_map = {c["name"]: c["type"] for c in orders_table["columns"]}
    assert col_map == {
        "order_id": "int",
        "customer_name": "string",
        "amount": "double",
    }, f"Unexpected columns: {col_map}"


@mock_aws
def test_schema_retrieval_multiple_databases():
    """Schema retrieval should return one entry per Glue database."""
    glue = boto3.client("glue", region_name=REGION)
    for db in ("finance", "marketing"):
        glue.create_database(DatabaseInput={"Name": db})

    connector = AthenaConnector("test-conn", BASE_CONFIG)
    schema = connector.get_schema()

    schema_names = {s["schema"] for s in schema}
    assert "finance" in schema_names
    assert "marketing" in schema_names


@mock_aws
def test_schema_retrieval_includes_partition_keys():
    """Partition keys should appear as columns in the schema output."""
    glue = boto3.client("glue", region_name=REGION)
    glue.create_database(DatabaseInput={"Name": "logs"})
    glue.create_table(
        DatabaseName="logs",
        TableInput={
            "Name": "events",
            "StorageDescriptor": {
                "Columns": [
                    {"Name": "event_type", "Type": "string"},
                ],
                "Location": f"s3://{S3_BUCKET}/logs/events/",
                "InputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                "SerdeInfo": {
                    "SerializationLibrary": "org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe"
                },
            },
            "PartitionKeys": [
                {"Name": "dt", "Type": "date"},
            ],
            "TableType": "EXTERNAL_TABLE",
        },
    )

    connector = AthenaConnector("test-conn", BASE_CONFIG)
    schema = connector.get_schema()

    logs_entry = next((s for s in schema if s["schema"] == "logs"), None)
    assert logs_entry is not None
    events_table = logs_entry["tables"][0]
    col_names = [c["name"] for c in events_table["columns"]]
    assert "event_type" in col_names, "Regular column missing"
    assert "dt" in col_names, "Partition key 'dt' should appear as a column"


# ---------------------------------------------------------------------------
# Test 2: Query execution returns tabular data without exceptions
# ---------------------------------------------------------------------------

@mock_aws
def test_query_execution_returns_tabular_data():
    """Executing a query via the Athena SQLAlchemy engine should return tabular rows.

    moto mocks the Athena REST API. PyAthena polls Athena (mocked) and reads results
    from S3 (mocked). The result set may be empty but must be returned as a list of
    dicts (tabular format) without raising any exception.
    """
    # Create S3 bucket required for staging dir
    s3 = boto3.client("s3", region_name=REGION)
    s3.create_bucket(Bucket=S3_BUCKET)

    connector = AthenaConnector("test-conn", BASE_CONFIG)
    engine = connector.get_engine()

    # Execute a simple query — must not raise
    rows = None
    columns = None
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1 AS value"))
        columns = list(result.keys())
        rows = [dict(row._mapping) for row in result]

    # Result is tabular: list of dicts
    assert isinstance(rows, list), "Rows must be a list"
    assert all(isinstance(row, dict) for row in rows), "Each row must be a dict"
    assert isinstance(columns, list), "Columns must be a list"


@mock_aws
def test_query_execution_json_result_is_tabular():
    """Results from Athena (delivered as JSON over REST) must be parsed into tabular rows.

    This confirms no exceptions arise from JSON-format result handling in PyAthena's
    REST cursor and that the connector's output matches the expected tabular contract.
    """
    s3 = boto3.client("s3", region_name=REGION)
    s3.create_bucket(Bucket=S3_BUCKET)

    connector = AthenaConnector("test-conn", BASE_CONFIG)
    engine = connector.get_engine()

    with engine.connect() as conn:
        result = conn.execute(text("SELECT 'hello' AS greeting, 42 AS answer"))
        rows = [dict(row._mapping) for row in result]

    assert isinstance(rows, list)
    assert all(isinstance(r, dict) for r in rows)


# ---------------------------------------------------------------------------
# Config validation tests
# ---------------------------------------------------------------------------

def test_validate_config_missing_required_fields():
    connector = AthenaConnector("test", {})
    result = connector.validate_config()
    assert result["valid"] is False
    assert any("region_name" in e for e in result["errors"])
    assert any("s3_staging_dir" in e for e in result["errors"])


def test_validate_config_invalid_s3_path():
    connector = AthenaConnector("test", {
        "region_name": "us-east-1",
        "s3_staging_dir": "not-an-s3-path",
    })
    result = connector.validate_config()
    assert result["valid"] is False
    assert any("s3://" in e for e in result["errors"])


def test_validate_config_partial_credentials():
    """Providing only one of key_id or secret should fail validation."""
    connector = AthenaConnector("test", {
        "region_name": "us-east-1",
        "s3_staging_dir": "s3://bucket/results/",
        "aws_access_key_id": "AKID",
        # missing aws_secret_access_key
    })
    result = connector.validate_config()
    assert result["valid"] is False
    assert any("together" in e for e in result["errors"])


def test_validate_config_valid_with_credentials():
    connector = AthenaConnector("test", {
        "region_name": "us-east-1",
        "s3_staging_dir": "s3://bucket/results/",
        "aws_access_key_id": "AKID",
        "aws_secret_access_key": "secret",
    })
    result = connector.validate_config()
    assert result["valid"] is True
    assert result["errors"] == []


def test_validate_config_valid_iam_role():
    """No credentials = IAM role auth — should be valid."""
    connector = AthenaConnector("test", {
        "region_name": "us-east-1",
        "s3_staging_dir": "s3://bucket/results/",
    })
    result = connector.validate_config()
    assert result["valid"] is True
    assert result["errors"] == []
