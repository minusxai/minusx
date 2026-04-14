"""
CSV Processor Module

Registers S3-hosted CSV/Parquet files as metadata entries for the in-memory
DuckDB connector.  No local files are created — DuckDB is used only as a
temporary engine to read column/row metadata from S3 at registration time.

S3 storage layout (enforced by frontend upload-url route):
    {companyId}/csvs/{mode}/{connectionName}/{uuid}.csv   (or .parquet)

The company_id prefix ensures strict cross-company isolation.
"""

import io
import re
import uuid
import asyncio
from pathlib import Path
from typing import List, Dict, Any

import boto3
import duckdb
import pandas as pd
from config import (
    BASE_DUCKDB_DATA_PATH,
    OBJECT_STORE_BUCKET,
    OBJECT_STORE_REGION,
    OBJECT_STORE_ACCESS_KEY_ID,
    OBJECT_STORE_SECRET_ACCESS_KEY,
    OBJECT_STORE_ENDPOINT,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def sanitize_table_name(filename: str) -> str:
    """Convert a filename to a valid SQL table name.

    - Remove file extension
    - Replace spaces/hyphens with underscores
    - Strip characters that aren't alphanumeric or underscore
    - Lowercase
    - Prefix with 't_' if it starts with a digit
    - Truncate to 63 chars (PostgreSQL identifier limit)
    """
    name = Path(filename).stem
    name = name.replace(' ', '_').replace('-', '_')
    name = re.sub(r'[^a-zA-Z0-9_]', '', name)
    name = name.lower()
    if name and name[0].isdigit():
        name = 't_' + name
    if not name:
        name = 'table_data'
    return name[:63]


def ensure_unique_table_names(filenames: List[str]) -> Dict[str, str]:
    """Return {filename: table_name} with collision-free names within the list."""
    result: Dict[str, str] = {}
    used: set = set()
    for filename in filenames:
        base = sanitize_table_name(filename)
        final = base
        counter = 1
        while final in used:
            final = f"{base}_{counter}"[:63]
            counter += 1
        result[filename] = final
        used.add(final)
    return result


def detect_file_format(filename: str) -> str:
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if ext in ('parquet', 'pq'):
        return 'parquet'
    if ext == 'xlsx':
        return 'xlsx'
    return 'csv'


def _open_s3_duckdb() -> duckdb.DuckDBPyConnection:
    """Open a temporary in-memory DuckDB connection configured for S3 access."""
    conn = duckdb.connect()
    conn.execute("INSTALL httpfs; LOAD httpfs;")
    conn.execute(f"SET s3_region='{OBJECT_STORE_REGION}'")
    conn.execute(f"SET s3_access_key_id='{OBJECT_STORE_ACCESS_KEY_ID or ''}'")
    conn.execute(f"SET s3_secret_access_key='{OBJECT_STORE_SECRET_ACCESS_KEY or ''}'")
    if OBJECT_STORE_ENDPOINT:
        conn.execute(f"SET s3_endpoint='{OBJECT_STORE_ENDPOINT}'")
        conn.execute("SET s3_url_style='path'")
    return conn


def _make_boto3_kwargs() -> Dict[str, Any]:
    kwargs: Dict[str, Any] = dict(
        region_name=OBJECT_STORE_REGION,
        aws_access_key_id=OBJECT_STORE_ACCESS_KEY_ID or None,
        aws_secret_access_key=OBJECT_STORE_SECRET_ACCESS_KEY or None,
    )
    if OBJECT_STORE_ENDPOINT:
        kwargs['endpoint_url'] = OBJECT_STORE_ENDPOINT
    return kwargs


def _expand_xlsx_to_csvs(
    s3_key: str,
    connection_name: str,
    company_id: int,
    mode: str,
    schema_name: str,
) -> List[Dict[str, str]]:
    """
    Download an xlsx from S3, convert each non-empty sheet to a CSV, upload the
    CSVs back to S3 under the same connection prefix, and return a list of file
    records ({filename, s3_key, schema_name, file_format}) — one per sheet.

    The original xlsx object is left in S3 (it will be removed with the
    connection when the user deletes it via the normal cleanup flow).
    """
    s3 = boto3.client('s3', **_make_boto3_kwargs())

    # Download xlsx bytes
    response = s3.get_object(Bucket=OBJECT_STORE_BUCKET, Key=s3_key)
    xlsx_bytes = response['Body'].read()

    # Parse with pandas
    xl = pd.ExcelFile(io.BytesIO(xlsx_bytes), engine='openpyxl')
    csv_records: List[Dict[str, str]] = []

    for sheet_name in xl.sheet_names:
        df = pd.read_excel(xl, sheet_name=sheet_name)
        if df.empty:
            continue
        safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', sheet_name)[:50].lower()
        csv_filename = f"{safe_name}.csv"
        csv_key = f"{company_id}/csvs/{mode}/{connection_name}/{uuid.uuid4().hex}_{csv_filename}"

        buf = io.StringIO()
        df.to_csv(buf, index=False)
        csv_bytes = buf.getvalue().encode('utf-8')

        s3.put_object(
            Bucket=OBJECT_STORE_BUCKET,
            Key=csv_key,
            Body=csv_bytes,
            ContentType='text/csv',
        )

        csv_records.append({
            'filename': csv_filename,
            's3_key': csv_key,
            'schema_name': schema_name,
            'file_format': 'csv',
        })

    if not csv_records:
        raise ValueError("No non-empty sheets found in the uploaded xlsx file")

    return csv_records


def _read_file_metadata(
    conn: duckdb.DuckDBPyConnection,
    s3_url: str,
    file_format: str,
    view_name: str,
) -> tuple:
    """Create a temp view and return (row_count, columns)."""
    if file_format == 'parquet':
        reader = f"read_parquet('{s3_url}')"
    else:
        reader = f"read_csv_auto('{s3_url}')"

    conn.execute(f'CREATE OR REPLACE TEMP VIEW "{view_name}" AS SELECT * FROM {reader}')

    row_count = conn.execute(f'SELECT COUNT(*) FROM "{view_name}"').fetchone()[0]

    # DESCRIBE returns: column_name, column_type, null, key, default, extra
    cols = conn.execute(f'DESCRIBE "{view_name}"').fetchall()
    columns = [{"name": c[0], "type": c[1]} for c in cols]
    return row_count, columns


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def process_csv_from_s3(
    company_id: int,
    mode: str,
    connection_name: str,
    files: List[Dict[str, str]],
    replace_existing: bool = False,
) -> Dict[str, Any]:
    """
    Validate S3-hosted CSV/Parquet files and collect metadata.

    No local files or DuckDB database files are created.  A temporary
    in-memory DuckDB is used only to read column names/types and row counts.

    Company isolation: S3 keys are expected to be prefixed with company_id
    (enforced by the frontend upload-url route).

    Args:
        company_id: Used only for logging/validation; the S3 key already
                    encodes the company so cross-company access is impossible.
        mode:       'org' | 'tutorial' etc.
        connection_name: Name of the CSV connection document.
        files:      List of {filename, s3_key, schema_name?, file_format?}
        replace_existing: Ignored (no-op); kept for API compatibility.

    Returns:
        {"files": [{table_name, schema_name, s3_key, file_format,
                    filename, row_count, columns}]}
    """
    if not OBJECT_STORE_BUCKET:
        raise ValueError(
            "OBJECT_STORE_BUCKET is not configured. "
            "Set OBJECT_STORE_BUCKET env var to enable S3-backed CSV connections."
        )

    # Expand xlsx files into per-sheet CSV records (blocking I/O runs off the event loop)
    expanded_files: List[Dict[str, str]] = []
    for file_info in files:
        fmt = file_info.get('file_format') or detect_file_format(file_info['filename'])
        if fmt == 'xlsx':
            schema_name = file_info.get('schema_name') or 'public'
            sheet_records = await asyncio.get_event_loop().run_in_executor(
                None,
                _expand_xlsx_to_csvs,
                file_info['s3_key'],
                connection_name,
                company_id,
                mode,
                schema_name,
            )
            expanded_files.extend(sheet_records)
        else:
            expanded_files.append(file_info)
    files = expanded_files

    # Separate files with user-provided table names from those that need auto-generation
    auto_gen_schema_filenames: Dict[str, List[str]] = {}
    for f in files:
        if not f.get('table_name'):
            schema = f.get('schema_name', 'public') or 'public'
            auto_gen_schema_filenames.setdefault(schema, []).append(f['filename'])

    schema_table_names: Dict[str, Dict[str, str]] = {
        schema: ensure_unique_table_names(fnames)
        for schema, fnames in auto_gen_schema_filenames.items()
    }

    # Validate user-provided names: unique within each schema, no collision with auto-gen names
    user_provided: Dict[str, set] = {}
    for f in files:
        if f.get('table_name'):
            schema = f.get('schema_name', 'public') or 'public'
            t = sanitize_table_name(f['table_name'])
            user_provided.setdefault(schema, set())
            if t in user_provided[schema]:
                raise ValueError(
                    f"Duplicate table name '{t}' in schema '{schema}'. "
                    "Please use unique table names."
                )
            user_provided[schema].add(t)

    # Cross-check: user-provided names must not collide with auto-generated names
    for schema, auto_names_map in schema_table_names.items():
        auto_names = set(auto_names_map.values())
        for t in user_provided.get(schema, set()):
            if t in auto_names:
                raise ValueError(
                    f"Table name '{t}' in schema '{schema}' conflicts with an "
                    "auto-generated name. Please rename the file or provide a unique table name."
                )

    conn = _open_s3_duckdb()
    file_metadata = []
    try:
        for file_info in files:
            filename = file_info['filename']
            s3_key = file_info['s3_key']
            schema_name = file_info.get('schema_name') or 'public'
            file_format = file_info.get('file_format') or detect_file_format(filename)
            # Use user-provided table name if present, else auto-generate
            if file_info.get('table_name'):
                table_name = sanitize_table_name(file_info['table_name'])
            else:
                table_name = schema_table_names[schema_name][filename]
            s3_url = f"s3://{OBJECT_STORE_BUCKET}/{s3_key}"

            # Unique view name to avoid conflicts between iterations
            view_name = f"_tmp_{schema_name}_{table_name}"
            row_count, columns = _read_file_metadata(conn, s3_url, file_format, view_name)

            file_metadata.append({
                "filename": filename,
                "table_name": table_name,
                "schema_name": schema_name,
                "s3_key": s3_key,
                "file_format": file_format,
                "row_count": row_count,
                "columns": columns,
            })
    finally:
        conn.close()

    return {"files": file_metadata}


def delete_csv_connection(company_id: int, mode: str, connection_name: str) -> bool:
    """
    Delete a CSV connection's S3 data.

    Lists and deletes all objects under the connection's S3 prefix.
    Returns True if any objects were deleted, False if none were found.
    """
    if not OBJECT_STORE_BUCKET:
        return False

    s3 = boto3.client('s3', **_make_boto3_kwargs())
    prefix = f"{company_id}/csvs/{mode}/{connection_name}/"

    paginator = s3.get_paginator('list_objects_v2')
    keys_to_delete = []
    for page in paginator.paginate(Bucket=OBJECT_STORE_BUCKET, Prefix=prefix):
        for obj in page.get('Contents', []):
            keys_to_delete.append({'Key': obj['Key']})

    if not keys_to_delete:
        return False

    s3.delete_objects(
        Bucket=OBJECT_STORE_BUCKET,
        Delete={'Objects': keys_to_delete},
    )
    return True


async def seed_company_tutorial(
    company_id: int,
    mode: str,
    connection_name: str,
    schema_name: str = "main",
) -> Dict[str, Any]:
    """
    Seed a company's tutorial CSV connection from the local mxfood.duckdb source.

    Reads each table from mxfood.duckdb and writes a Parquet file directly to S3
    using DuckDB's httpfs extension (no intermediate local files).  Returns the
    same file-metadata structure as process_csv_from_s3 so the caller can update
    the connection document directly.

    S3 key layout:
        {company_id}/csvs/{mode}/{connection_name}/{table_name}.parquet

    No-ops gracefully when:
      - OBJECT_STORE_BUCKET is not configured
      - mxfood.duckdb cannot be found
    """
    if not OBJECT_STORE_BUCKET:
        return {"files": [], "skipped": True, "reason": "OBJECT_STORE_BUCKET not configured"}

    mxfood_path = Path(BASE_DUCKDB_DATA_PATH) / "data" / "mxfood.duckdb"
    if not mxfood_path.exists():
        return {"files": [], "skipped": True, "reason": f"mxfood.duckdb not found at {mxfood_path}"}

    def _seed_sync() -> Dict[str, Any]:
        # Open source DuckDB and configure httpfs for S3 writes in one connection.
        conn = duckdb.connect(str(mxfood_path), read_only=True)
        try:
            conn.execute("INSTALL httpfs; LOAD httpfs;")
            conn.execute(f"SET s3_region='{OBJECT_STORE_REGION}'")
            conn.execute(f"SET s3_access_key_id='{OBJECT_STORE_ACCESS_KEY_ID or ''}'")
            conn.execute(f"SET s3_secret_access_key='{OBJECT_STORE_SECRET_ACCESS_KEY or ''}'")
            if OBJECT_STORE_ENDPOINT:
                conn.execute(f"SET s3_endpoint='{OBJECT_STORE_ENDPOINT}'")
                conn.execute("SET s3_url_style='path'")

            tables = [row[0] for row in conn.execute("SHOW TABLES").fetchall()]
            file_metadata = []

            for table_name in tables:
                s3_key = f"{company_id}/csvs/{mode}/{connection_name}/{table_name}.parquet"
                s3_url = f"s3://{OBJECT_STORE_BUCKET}/{s3_key}"

                # Write table to S3 as Parquet directly from the source DuckDB
                conn.execute(
                    f"COPY (SELECT * FROM main.\"{table_name}\") "
                    f"TO '{s3_url}' (FORMAT PARQUET)"
                )

                # Read metadata back from the newly written Parquet file
                view_name = f"_seed_{table_name}"
                row_count, columns = _read_file_metadata(conn, s3_url, "parquet", view_name)

                file_metadata.append({
                    "filename": f"{table_name}.parquet",
                    "table_name": table_name,
                    "schema_name": schema_name,
                    "s3_key": s3_key,
                    "file_format": "parquet",
                    "row_count": row_count,
                    "columns": columns,
                })
        finally:
            conn.close()

        return {"files": file_metadata}

    # Run the blocking DuckDB work off the event loop
    return await asyncio.get_event_loop().run_in_executor(None, _seed_sync)
