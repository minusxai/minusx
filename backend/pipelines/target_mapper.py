"""
Maps MinusX database connections to Singer target configurations.
"""
import tempfile
import json
from typing import Dict, Any
from pathlib import Path
from config import BASE_DUCKDB_DATA_PATH


def generate_target_config(
    connection_name: str,
    connection_type: str,
    connection_config: Dict[str, Any],
    schema: str = "default"
) -> tuple[Dict[str, Any], list[str]]:
    """
    Generate Singer target configuration from Atlas connection.

    Args:
        connection_name: Name of the connection (e.g., "default_db")
        connection_type: Type of connection ("duckdb" or "bigquery")
        connection_config: Connection configuration dict
        schema: Target schema name (defaults to "default")

    Returns:
        Tuple of (target_config_dict, list_of_temp_files_to_cleanup)
    """
    temp_files = []

    if connection_type == "duckdb":
        # target-duckdb expects: path, default_target_schema
        file_path = connection_config.get('file_path')
        if not file_path:
            raise ValueError("DuckDB connection missing 'file_path'")

        # Resolve path using BASE_DUCKDB_DATA_PATH (same logic as duckdb_connector)
        if Path(file_path).is_absolute():
            full_path = file_path
        else:
            full_path = str(Path(BASE_DUCKDB_DATA_PATH) / file_path)

        return {
            "path": full_path,
            "default_target_schema": schema,
            "hard_delete": False,  # Soft deletes by default
            "primary_key_required": False,  # Allow tables without primary keys (e.g., tap-facebook adimages)
        }, temp_files

    elif connection_type == "bigquery":
        # target-bigquery expects: credentials_path, project, dataset
        service_account_json = connection_config.get('service_account_json')
        project_id = connection_config.get('project_id')

        if not service_account_json or not project_id:
            raise ValueError("BigQuery connection missing 'service_account_json' or 'project_id'")

        # Write credentials to temp file
        fd, creds_path = tempfile.mkstemp(suffix='.json', prefix='bq_creds_')
        with os.fdopen(fd, 'w') as f:
            f.write(service_account_json)

        temp_files.append(creds_path)

        return {
            "credentials_path": creds_path,
            "project": project_id,
            "dataset": schema,
            "location": "US",  # Default location
        }, temp_files

    else:
        raise ValueError(f"Unsupported connection type: {connection_type}")