"""
CSV Processor Module

Registers S3-hosted CSV/Parquet files as metadata entries for the in-memory
DuckDB connector.  No local files are created — DuckDB is used only as a
temporary engine to read column/row metadata from S3 at registration time.

S3 storage layout (enforced by frontend upload-url route):
    {companyId}/csvs/{mode}/{connectionName}/{uuid}.csv   (or .parquet)

The company_id prefix ensures strict cross-company isolation.
"""

import re
import asyncio
from pathlib import Path
from typing import List, Dict, Any

import duckdb
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
    return 'parquet' if ext in ('parquet', 'pq') else 'csv'


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

    # Validate user-provided names for uniqueness within each schema
    user_provided: Dict[str, set] = {}
    for f in files:
        if f.get('table_name'):
            schema = f.get('schema_name', 'public') or 'public'
            t = sanitize_table_name(f['table_name'] + '.x')  # sanitize user input
            # Re-sanitize: user provided bare name (no extension), strip nothing
            t = sanitize_table_name(f['table_name'])
            user_provided.setdefault(schema, set())
            if t in user_provided[schema]:
                raise ValueError(
                    f"Duplicate table name '{t}' in schema '{schema}'. "
                    "Please use unique table names."
                )
            user_provided[schema].add(t)

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
