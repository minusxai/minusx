"""Async wrapper for Google Sheets connector (delegates to async DuckDB)"""

from .base import AsyncDatabaseConnector
from . import register_connector
from .duckdb_connector_async import AsyncDuckDBConnector
from pathlib import Path
from config import BASE_DUCKDB_DATA_PATH
from typing import List, Dict, Any


@register_connector('google-sheets')
class AsyncGoogleSheetsConnector(AsyncDatabaseConnector):
    """
    Google Sheets-based async connector that wraps AsyncDuckDBConnector.

    Config:
        spreadsheet_url: str - Original Google Sheets URL
        spreadsheet_id: str - Extracted spreadsheet ID
        generated_db_path: str - Relative path to generated DuckDB file
        files: list - List of file metadata [{filename, table_name, row_count, columns}]
    """

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self._duckdb_connector = None

    def _get_duckdb_connector(self) -> AsyncDuckDBConnector:
        """Lazily create and return the underlying async DuckDB connector."""
        if not self._duckdb_connector:
            generated_db_path = self.config.get('generated_db_path', '')

            # Create async DuckDB connector with the generated database path
            duckdb_config = {'file_path': generated_db_path}
            self._duckdb_connector = AsyncDuckDBConnector(self.name, duckdb_config)

        return self._duckdb_connector

    async def get_engine(self):
        """Return SQLAlchemy engine from underlying async DuckDB connector."""
        return await self._get_duckdb_connector().get_engine()

    async def test_connection(self) -> dict:
        """Test if the Google Sheets connection is valid (DuckDB database exists and is accessible)."""
        generated_db_path = self.config.get('generated_db_path', '')

        if not generated_db_path:
            return {
                "success": False,
                "message": "No database generated. Please import a Google Sheet first."
            }

        # Check if file exists
        if Path(generated_db_path).is_absolute():
            resolved_path = generated_db_path
        else:
            resolved_path = str(Path(BASE_DUCKDB_DATA_PATH) / generated_db_path)

        if not Path(resolved_path).exists():
            return {
                "success": False,
                "message": f"Database file not found: {generated_db_path}"
            }

        # Delegate to async DuckDB connector for actual connection test
        return await self._get_duckdb_connector().test_connection()

    async def _fetch_schema(self) -> List[Dict[str, Any]]:
        """Get database schema from underlying DuckDB database."""
        generated_db_path = self.config.get('generated_db_path', '')

        if not generated_db_path:
            return []

        # Use get_schema which handles caching internally
        return await self._get_duckdb_connector().get_schema()

    def validate_config(self) -> dict:
        """
        Validate Google Sheets connection configuration.

        For Google Sheets connections, we mainly validate that:
        - generated_db_path is present (after import)
        - files metadata is present
        """
        errors = []

        generated_db_path = self.config.get('generated_db_path', '')

        # It's OK to have empty path before import
        # The frontend will handle validation during import
        if generated_db_path:
            # Resolve path
            if Path(generated_db_path).is_absolute():
                resolved_path = generated_db_path
            else:
                resolved_path = str(Path(BASE_DUCKDB_DATA_PATH) / generated_db_path)

            # Check if database exists
            if not Path(resolved_path).exists():
                errors.append(f"Generated database not found: {generated_db_path}")

        return {"valid": len(errors) == 0, "errors": errors}

    async def close(self):
        """Close connection and clean up resources."""
        if self._duckdb_connector:
            await self._duckdb_connector.close()
            self._duckdb_connector = None
        await super().close()
