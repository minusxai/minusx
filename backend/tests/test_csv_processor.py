"""
Unit and integration tests for the CSV processor module.

Unit tests cover pure helper functions (no AWS/DuckDB required).
Integration tests mock the DuckDB S3 layer (using patch) and verify the
registration flow: key construction, schema grouping, name deduplication,
and metadata assembly.
"""

import os
import csv
import io
import pytest
from unittest.mock import patch, MagicMock

# ---------------------------------------------------------------------------
# Unit tests — no AWS/DuckDB required
# ---------------------------------------------------------------------------

from processors.csv_processor import (
    sanitize_table_name,
    ensure_unique_table_names,
    detect_file_format,
)


class TestSanitizeTableName:
    def test_basic_filename(self):
        assert sanitize_table_name("sales_data.csv") == "sales_data"

    def test_spaces_become_underscores(self):
        assert sanitize_table_name("my file.csv") == "my_file"

    def test_hyphens_become_underscores(self):
        assert sanitize_table_name("my-file.csv") == "my_file"

    def test_leading_digit_prefixed(self):
        assert sanitize_table_name("2024_data.csv") == "t_2024_data"

    def test_special_chars_stripped(self):
        assert sanitize_table_name("revenue (Q1).csv") == "revenue_q1"

    def test_empty_after_sanitize_becomes_table_data(self):
        assert sanitize_table_name("!!.csv") == "table_data"

    def test_truncated_to_63_chars(self):
        long_name = "a" * 70 + ".csv"
        result = sanitize_table_name(long_name)
        assert len(result) <= 63

    def test_parquet_extension_stripped(self):
        assert sanitize_table_name("orders.parquet") == "orders"

    def test_no_extension(self):
        assert sanitize_table_name("orders") == "orders"


class TestEnsureUniqueTableNames:
    def test_no_collision(self):
        result = ensure_unique_table_names(["a.csv", "b.csv"])
        assert result == {"a.csv": "a", "b.csv": "b"}

    def test_collision_adds_suffix(self):
        result = ensure_unique_table_names(["data.csv", "data.parquet"])
        values = list(result.values())
        assert len(set(values)) == 2  # all unique
        assert "data" in values

    def test_empty_list(self):
        assert ensure_unique_table_names([]) == {}


class TestDetectFileFormat:
    def test_csv(self):
        assert detect_file_format("sales.csv") == "csv"

    def test_parquet(self):
        assert detect_file_format("orders.parquet") == "parquet"

    def test_pq_short_extension(self):
        assert detect_file_format("data.pq") == "parquet"

    def test_unknown_defaults_to_csv(self):
        assert detect_file_format("data.xlsx") == "csv"

    def test_uppercase_extension(self):
        # Extension comparison is case-insensitive
        assert detect_file_format("DATA.PARQUET") == "parquet"


# ---------------------------------------------------------------------------
# Integration tests — mock the DuckDB S3 layer
# ---------------------------------------------------------------------------

FAKE_BUCKET = "test-csv-bucket"

# Stub metadata for a single-column, 3-row CSV
STUB_METADATA = (3, [{"name": "id", "type": "INTEGER"}, {"name": "name", "type": "VARCHAR"}])


def _mock_open_s3_duckdb():
    """Return a real in-memory DuckDB connection (no S3 config needed)."""
    import duckdb
    return duckdb.connect()


@pytest.fixture(autouse=True)
def set_object_store_env():
    """Patch the module-level OBJECT_STORE_BUCKET constant so the guard check passes."""
    import processors.csv_processor as csv_mod
    with patch.object(csv_mod, "OBJECT_STORE_BUCKET", FAKE_BUCKET):
        yield


@pytest.mark.asyncio
async def test_process_csv_from_s3_single_file():
    """Single file registers correctly: table name, schema, s3_key in result."""
    import processors.csv_processor as csv_mod

    s3_key = "1/csvs/org/test_conn/students.csv"

    with patch.object(csv_mod, "_open_s3_duckdb", side_effect=_mock_open_s3_duckdb), \
         patch.object(csv_mod, "_read_file_metadata", return_value=STUB_METADATA):
        result = await csv_mod.process_csv_from_s3(
            company_id=1,
            mode="org",
            connection_name="test_conn",
            files=[{"filename": "students.csv", "s3_key": s3_key, "schema_name": "public"}],
        )

    assert len(result["files"]) == 1
    file_info = result["files"][0]
    assert file_info["table_name"] == "students"
    assert file_info["schema_name"] == "public"
    assert file_info["s3_key"] == s3_key
    assert file_info["row_count"] == 3
    assert file_info["columns"] == STUB_METADATA[1]


@pytest.mark.asyncio
async def test_process_csv_from_s3_multiple_files_multi_schema():
    """Multiple files across different schemas are all registered."""
    import processors.csv_processor as csv_mod

    files_input = [
        {"filename": "products.csv", "s3_key": "2/csvs/org/c/products.csv", "schema_name": "inventory"},
        {"filename": "regions.csv", "s3_key": "2/csvs/org/c/regions.csv", "schema_name": "sales"},
    ]

    with patch.object(csv_mod, "_open_s3_duckdb", side_effect=_mock_open_s3_duckdb), \
         patch.object(csv_mod, "_read_file_metadata", return_value=STUB_METADATA):
        result = await csv_mod.process_csv_from_s3(
            company_id=2,
            mode="org",
            connection_name="c",
            files=files_input,
        )

    assert len(result["files"]) == 2
    by_table = {f["table_name"]: f for f in result["files"]}
    assert by_table["products"]["schema_name"] == "inventory"
    assert by_table["regions"]["schema_name"] == "sales"


@pytest.mark.asyncio
async def test_process_csv_from_s3_no_bucket_raises():
    """Raises ValueError when OBJECT_STORE_BUCKET is not set."""
    import processors.csv_processor as csv_mod

    # Override the autouse fixture — patch bucket to None/empty
    with patch.object(csv_mod, "OBJECT_STORE_BUCKET", None):
        with pytest.raises(ValueError, match="OBJECT_STORE_BUCKET"):
            await csv_mod.process_csv_from_s3(
                company_id=1,
                mode="org",
                connection_name="conn",
                files=[{"filename": "x.csv", "s3_key": "1/x.csv", "schema_name": "public"}],
            )


@pytest.mark.asyncio
async def test_process_csv_from_s3_collision_deduplication():
    """Two files with the same sanitized name get unique table names."""
    import processors.csv_processor as csv_mod

    files_input = [
        {"filename": "data.csv", "s3_key": "3/data.csv", "schema_name": "public"},
        {"filename": "data (1).csv", "s3_key": "3/data1.csv", "schema_name": "public"},
    ]

    with patch.object(csv_mod, "_open_s3_duckdb", side_effect=_mock_open_s3_duckdb), \
         patch.object(csv_mod, "_read_file_metadata", return_value=STUB_METADATA):
        result = await csv_mod.process_csv_from_s3(
            company_id=3,
            mode="org",
            connection_name="dedup",
            files=files_input,
        )

    table_names = [f["table_name"] for f in result["files"]]
    assert len(set(table_names)) == len(table_names), "Table names must be unique"


@pytest.mark.asyncio
async def test_process_csv_from_s3_default_schema_is_public():
    """Files without schema_name default to 'public'."""
    import processors.csv_processor as csv_mod

    with patch.object(csv_mod, "_open_s3_duckdb", side_effect=_mock_open_s3_duckdb), \
         patch.object(csv_mod, "_read_file_metadata", return_value=STUB_METADATA):
        result = await csv_mod.process_csv_from_s3(
            company_id=1,
            mode="org",
            connection_name="noschema",
            files=[{"filename": "t.csv", "s3_key": "1/t.csv"}],  # No schema_name
        )

    assert result["files"][0]["schema_name"] == "public"


@pytest.mark.asyncio
async def test_process_csv_from_s3_user_provided_name_clashes_with_auto_gen():
    """Raises ValueError when a user-provided table_name collides with an auto-generated name in the same schema."""
    import processors.csv_processor as csv_mod

    # 'products.csv' auto-generates to 'products'; user provides 'products' for the second file — collision
    files_input = [
        {"filename": "products.csv", "s3_key": "1/products.csv", "schema_name": "public"},
        {"filename": "other.csv",    "s3_key": "1/other.csv",    "schema_name": "public", "table_name": "products"},
    ]

    with patch.object(csv_mod, "OBJECT_STORE_BUCKET", FAKE_BUCKET), \
         patch.object(csv_mod, "_open_s3_duckdb", side_effect=_mock_open_s3_duckdb), \
         patch.object(csv_mod, "_read_file_metadata", return_value=STUB_METADATA):
        with pytest.raises(ValueError, match="products"):
            await csv_mod.process_csv_from_s3(
                company_id=1,
                mode="org",
                connection_name="conn",
                files=files_input,
            )


@pytest.mark.asyncio
async def test_process_csv_from_s3_user_provided_table_name():
    """User-provided table_name in file record is used instead of auto-generating from filename."""
    import processors.csv_processor as csv_mod

    with patch.object(csv_mod, "_open_s3_duckdb", side_effect=_mock_open_s3_duckdb), \
         patch.object(csv_mod, "_read_file_metadata", return_value=STUB_METADATA):
        result = await csv_mod.process_csv_from_s3(
            company_id=1,
            mode="org",
            connection_name="conn",
            files=[{
                "filename": "some_random_filename.csv",
                "s3_key": "1/some_random_filename.csv",
                "schema_name": "public",
                "table_name": "my_custom_name",   # user override
            }],
        )

    assert result["files"][0]["table_name"] == "my_custom_name"


@pytest.mark.asyncio
async def test_process_csv_from_s3_parquet_format():
    """Parquet format is detected from filename and included in result."""
    import processors.csv_processor as csv_mod

    with patch.object(csv_mod, "_open_s3_duckdb", side_effect=_mock_open_s3_duckdb), \
         patch.object(csv_mod, "_read_file_metadata", return_value=STUB_METADATA) as mock_meta:
        result = await csv_mod.process_csv_from_s3(
            company_id=1,
            mode="org",
            connection_name="parq",
            files=[{"filename": "orders.parquet", "s3_key": "1/orders.parquet", "schema_name": "main"}],
        )

    file_info = result["files"][0]
    assert file_info["file_format"] == "parquet"
    # Verify _read_file_metadata was called with "parquet" format
    _, call_kwargs = mock_meta.call_args
    assert call_kwargs.get("file_format") == "parquet" or mock_meta.call_args[0][2] == "parquet"


# ---------------------------------------------------------------------------
# Tests for process_google_sheets_import_s3
# ---------------------------------------------------------------------------

import io
import pandas as pd


def _make_fake_xlsx_bytes() -> bytes:
    """Build a minimal xlsx in-memory using pandas + openpyxl."""
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine='openpyxl') as writer:
        pd.DataFrame({'a': [1, 2], 'b': ['x', 'y']}).to_excel(writer, sheet_name='Sheet1', index=False)
    return buf.getvalue()


FAKE_GS_BUCKET = "gs-test-bucket"
FAKE_SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/abc123XYZ/edit"
FAKE_SPREADSHEET_ID = "abc123XYZ"

STUB_GS_METADATA = (2, [{"name": "a", "type": "INTEGER"}, {"name": "b", "type": "VARCHAR"}])


@pytest.fixture()
def gs_mod():
    """Import the google_sheets_processor module."""
    import processors.google_sheets_processor as mod
    return mod


class TestProcessGoogleSheetsImportS3:
    """Tests for process_google_sheets_import_s3."""

    @pytest.mark.asyncio
    async def test_calls_process_csv_from_s3_with_correct_schema(self, gs_mod):
        """process_google_sheets_import_s3 passes schema_name to process_csv_from_s3."""
        import processors.csv_processor as csv_mod

        xlsx_bytes = _make_fake_xlsx_bytes()
        stub_csv_result = {
            "files": [
                {
                    "filename": "Sheet1.csv",
                    "table_name": "sheet1",
                    "schema_name": "analytics",
                    "s3_key": "1/csvs/org/gs_conn/abc_Sheet1.csv",
                    "file_format": "csv",
                    "row_count": 2,
                    "columns": STUB_GS_METADATA[1],
                }
            ]
        }

        with patch.object(gs_mod, "OBJECT_STORE_BUCKET", FAKE_GS_BUCKET), \
             patch.object(gs_mod, "download_xlsx", return_value=xlsx_bytes), \
             patch.object(gs_mod, "_upload_bytes_to_s3", return_value=None), \
             patch.object(gs_mod, "process_csv_from_s3", return_value=stub_csv_result) as mock_csv:
            result = await gs_mod.process_google_sheets_import_s3(
                company_id=1,
                mode="org",
                connection_name="gs_conn",
                spreadsheet_url=FAKE_SPREADSHEET_URL,
                schema_name="analytics",
                replace_existing=False,
            )

        # process_csv_from_s3 must have been called with schema_name="analytics"
        call_kwargs = mock_csv.call_args
        files_arg = call_kwargs.args[3] if len(call_kwargs.args) > 3 else call_kwargs.kwargs.get('files', [])
        for f in files_arg:
            assert f['schema_name'] == 'analytics', f"Expected schema_name='analytics', got {f['schema_name']}"

    @pytest.mark.asyncio
    async def test_adds_spreadsheet_url_and_id_to_result(self, gs_mod):
        """Result must include spreadsheet_url and spreadsheet_id."""
        xlsx_bytes = _make_fake_xlsx_bytes()
        stub_csv_result = {"files": []}

        with patch.object(gs_mod, "OBJECT_STORE_BUCKET", FAKE_GS_BUCKET), \
             patch.object(gs_mod, "download_xlsx", return_value=xlsx_bytes), \
             patch.object(gs_mod, "_upload_bytes_to_s3", return_value=None), \
             patch.object(gs_mod, "process_csv_from_s3", return_value=stub_csv_result):
            result = await gs_mod.process_google_sheets_import_s3(
                company_id=1,
                mode="org",
                connection_name="gs_conn",
                spreadsheet_url=FAKE_SPREADSHEET_URL,
                schema_name="public",
            )

        assert result['spreadsheet_url'] == FAKE_SPREADSHEET_URL
        assert result['spreadsheet_id'] == FAKE_SPREADSHEET_ID

    @pytest.mark.asyncio
    async def test_raises_value_error_when_bucket_not_set(self, gs_mod):
        """Raises ValueError when OBJECT_STORE_BUCKET is not configured."""
        with patch.object(gs_mod, "OBJECT_STORE_BUCKET", None):
            with pytest.raises(ValueError, match="OBJECT_STORE_BUCKET"):
                await gs_mod.process_google_sheets_import_s3(
                    company_id=1,
                    mode="org",
                    connection_name="gs_conn",
                    spreadsheet_url=FAKE_SPREADSHEET_URL,
                )

    @pytest.mark.asyncio
    async def test_upload_bytes_called_with_correct_s3_key(self, gs_mod):
        """_upload_bytes_to_s3 is called with a key matching the expected S3 path pattern."""
        xlsx_bytes = _make_fake_xlsx_bytes()
        stub_csv_result = {"files": []}

        with patch.object(gs_mod, "OBJECT_STORE_BUCKET", FAKE_GS_BUCKET), \
             patch.object(gs_mod, "download_xlsx", return_value=xlsx_bytes), \
             patch.object(gs_mod, "_upload_bytes_to_s3", return_value=None) as mock_upload, \
             patch.object(gs_mod, "process_csv_from_s3", return_value=stub_csv_result):
            await gs_mod.process_google_sheets_import_s3(
                company_id=42,
                mode="org",
                connection_name="gs_conn",
                spreadsheet_url=FAKE_SPREADSHEET_URL,
                schema_name="public",
            )

        assert mock_upload.call_count >= 1
        for call in mock_upload.call_args_list:
            s3_key = call.args[0] if call.args else call.kwargs.get('s3_key')
            # Key must follow pattern: {company_id}/csvs/{mode}/{connection_name}/{uuid}_{filename}.csv
            assert s3_key.startswith("42/csvs/org/gs_conn/"), (
                f"S3 key '{s3_key}' does not start with '42/csvs/org/gs_conn/'"
            )
            assert s3_key.endswith(".csv"), f"S3 key '{s3_key}' should end with .csv"

    @pytest.mark.asyncio
    async def test_replace_existing_deletes_old_s3_files_before_reimport(self, gs_mod):
        """When replace_existing=True, delete_google_sheets_connection is called before uploading new files."""
        xlsx_bytes = _make_fake_xlsx_bytes()
        stub_csv_result = {"files": []}

        with patch.object(gs_mod, "OBJECT_STORE_BUCKET", FAKE_GS_BUCKET), \
             patch.object(gs_mod, "download_xlsx", return_value=xlsx_bytes), \
             patch.object(gs_mod, "_upload_bytes_to_s3", return_value=None), \
             patch.object(gs_mod, "process_csv_from_s3", return_value=stub_csv_result), \
             patch.object(gs_mod, "delete_google_sheets_connection", return_value=True) as mock_delete:
            await gs_mod.process_google_sheets_import_s3(
                company_id=5,
                mode="org",
                connection_name="gs_conn",
                spreadsheet_url=FAKE_SPREADSHEET_URL,
                schema_name="public",
                replace_existing=True,
            )

        mock_delete.assert_called_once_with(5, "org", "gs_conn")

    @pytest.mark.asyncio
    async def test_replace_existing_false_does_not_delete(self, gs_mod):
        """When replace_existing=False (default), delete_google_sheets_connection is NOT called."""
        xlsx_bytes = _make_fake_xlsx_bytes()
        stub_csv_result = {"files": []}

        with patch.object(gs_mod, "OBJECT_STORE_BUCKET", FAKE_GS_BUCKET), \
             patch.object(gs_mod, "download_xlsx", return_value=xlsx_bytes), \
             patch.object(gs_mod, "_upload_bytes_to_s3", return_value=None), \
             patch.object(gs_mod, "process_csv_from_s3", return_value=stub_csv_result), \
             patch.object(gs_mod, "delete_google_sheets_connection", return_value=True) as mock_delete:
            await gs_mod.process_google_sheets_import_s3(
                company_id=5,
                mode="org",
                connection_name="gs_conn",
                spreadsheet_url=FAKE_SPREADSHEET_URL,
                schema_name="public",
                replace_existing=False,
            )

        mock_delete.assert_not_called()
