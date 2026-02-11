"""
CSV Processor Module

Handles CSV file upload, storage, and DuckDB database generation.

Storage Structure:
    data/
      csv_connections/
        {company_id}/
          {mode}/
            {connection_name}/
              files/
                table1.csv
                table2.csv
              database.duckdb
"""

import re
import shutil
from pathlib import Path
from typing import List, Dict, Any, Optional
import duckdb
from config import BASE_DUCKDB_DATA_PATH


def get_csv_base_dir() -> Path:
    """Get the base directory for CSV connections (inside data folder)."""
    return Path(BASE_DUCKDB_DATA_PATH) / "data" / "csv_connections"


def get_csv_connection_dir(company_id: int, mode: str, connection_name: str) -> Path:
    """Get the directory for a specific CSV connection."""
    return get_csv_base_dir() / str(company_id) / mode / connection_name


def sanitize_table_name(filename: str) -> str:
    """
    Convert a filename to a valid SQL table name.

    Rules:
    - Remove file extension
    - Replace spaces and hyphens with underscores
    - Remove special characters (keep only alphanumeric and underscore)
    - Convert to lowercase
    - If starts with number, prefix with 't_'
    - Truncate to 63 chars (PostgreSQL limit for identifiers)
    """
    # Remove extension
    name = Path(filename).stem

    # Replace spaces and hyphens with underscores
    name = name.replace(' ', '_').replace('-', '_')

    # Keep only alphanumeric and underscore
    name = re.sub(r'[^a-zA-Z0-9_]', '', name)

    # Convert to lowercase
    name = name.lower()

    # If starts with number, prefix with 't_'
    if name and name[0].isdigit():
        name = 't_' + name

    # If empty after sanitization, use default name
    if not name:
        name = 'table_data'

    # Truncate to 63 chars
    name = name[:63]

    return name


def ensure_unique_table_names(filenames: List[str]) -> Dict[str, str]:
    """
    Generate unique table names for a list of filenames.

    Returns a dict mapping filename -> table_name.
    Handles collisions by adding numeric suffixes.
    """
    table_names: Dict[str, str] = {}
    used_names: set = set()

    for filename in filenames:
        base_name = sanitize_table_name(filename)
        final_name = base_name
        counter = 1

        while final_name in used_names:
            final_name = f"{base_name}_{counter}"[:63]
            counter += 1

        table_names[filename] = final_name
        used_names.add(final_name)

    return table_names


async def process_csv_upload(
    company_id: int,
    mode: str,
    connection_name: str,
    files: List[tuple],  # List of (filename, content_bytes)
    replace_existing: bool = False
) -> Dict[str, Any]:
    """
    Process uploaded CSV files and create DuckDB database.

    Args:
        company_id: Company ID for multi-tenant isolation
        mode: Mode for isolation (org, tutorial, etc.)
        connection_name: Name of the connection
        files: List of (filename, content_bytes) tuples
        replace_existing: If True, replace existing files; if False, error on existing

    Returns:
        Dict with:
        - generated_db_path: Relative path to the generated DuckDB file
        - files: List of file metadata (filename, table_name, row_count, columns)
    """
    conn_dir = get_csv_connection_dir(company_id, mode, connection_name)
    files_dir = conn_dir / "files"
    db_path = conn_dir / "database.duckdb"

    # Check if connection directory exists
    if conn_dir.exists():
        if replace_existing:
            # Clear existing files and database
            if files_dir.exists():
                shutil.rmtree(files_dir)
            if db_path.exists():
                db_path.unlink()
        else:
            raise ValueError(f"Connection '{connection_name}' already has data. Use replace_existing=True to overwrite.")

    # Create directories
    files_dir.mkdir(parents=True, exist_ok=True)

    # Generate unique table names
    filenames = [f[0] for f in files]
    table_names = ensure_unique_table_names(filenames)

    # Save CSV files
    saved_files = []
    for filename, content in files:
        file_path = files_dir / filename
        with open(file_path, 'wb') as f:
            f.write(content)
        saved_files.append({
            'filename': filename,
            'table_name': table_names[filename],
            'file_path': str(file_path)
        })

    # Create DuckDB database and import CSVs
    file_metadata = []

    try:
        conn = duckdb.connect(str(db_path))

        for file_info in saved_files:
            table_name = file_info['table_name']
            file_path = file_info['file_path']

            # Create table from CSV using read_csv_auto
            conn.execute(f"""
                CREATE TABLE "{table_name}" AS
                SELECT * FROM read_csv_auto('{file_path}')
            """)

            # Get row count
            result = conn.execute(f'SELECT COUNT(*) FROM "{table_name}"').fetchone()
            row_count = result[0] if result else 0

            # Get column info
            columns_result = conn.execute(f"""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = '{table_name}'
                ORDER BY ordinal_position
            """).fetchall()

            columns = [{"name": col[0], "type": col[1]} for col in columns_result]

            file_metadata.append({
                "filename": file_info['filename'],
                "table_name": table_name,
                "row_count": row_count,
                "columns": columns
            })

        conn.close()

    except Exception as e:
        # Cleanup on error
        if conn_dir.exists():
            shutil.rmtree(conn_dir)
        raise RuntimeError(f"Failed to create DuckDB database: {str(e)}")

    # Generate relative path from BASE_DUCKDB_DATA_PATH
    relative_db_path = f"data/csv_connections/{company_id}/{mode}/{connection_name}/database.duckdb"

    return {
        "generated_db_path": relative_db_path,
        "files": file_metadata
    }


def delete_csv_connection(company_id: int, mode: str, connection_name: str) -> bool:
    """
    Delete a CSV connection's data (files and database).

    Args:
        company_id: Company ID
        mode: Mode for isolation
        connection_name: Connection name

    Returns:
        True if data was deleted, False if connection didn't exist
    """
    conn_dir = get_csv_connection_dir(company_id, mode, connection_name)

    if not conn_dir.exists():
        return False

    shutil.rmtree(conn_dir)
    return True


def get_csv_connection_info(company_id: int, mode: str, connection_name: str) -> Optional[Dict[str, Any]]:
    """
    Get info about an existing CSV connection.

    Returns None if connection doesn't exist.
    """
    conn_dir = get_csv_connection_dir(company_id, mode, connection_name)
    files_dir = conn_dir / "files"
    db_path = conn_dir / "database.duckdb"

    if not db_path.exists():
        return None

    # List CSV files
    csv_files = []
    if files_dir.exists():
        csv_files = [f.name for f in files_dir.iterdir() if f.suffix.lower() == '.csv']

    # Get table info from database
    file_metadata = []
    try:
        conn = duckdb.connect(str(db_path), read_only=True)

        # Get all tables
        tables = conn.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'main'
        """).fetchall()

        for (table_name,) in tables:
            # Get row count
            result = conn.execute(f'SELECT COUNT(*) FROM "{table_name}"').fetchone()
            row_count = result[0] if result else 0

            # Get column info
            columns_result = conn.execute(f"""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = '{table_name}'
                ORDER BY ordinal_position
            """).fetchall()

            columns = [{"name": col[0], "type": col[1]} for col in columns_result]

            # Try to find matching CSV file
            matching_file = next((f for f in csv_files if sanitize_table_name(f) == table_name), None)

            file_metadata.append({
                "filename": matching_file or f"{table_name}.csv",
                "table_name": table_name,
                "row_count": row_count,
                "columns": columns
            })

        conn.close()

    except Exception as e:
        print(f"Error reading CSV connection info: {e}")
        return None

    relative_db_path = f"data/csv_connections/{company_id}/{mode}/{connection_name}/database.duckdb"

    return {
        "generated_db_path": relative_db_path,
        "files": file_metadata
    }
