"""Async Google Sheets connector — delegates to AsyncCsvConnector (same S3-backed config)."""

from .base import AsyncDatabaseConnector
from . import register_connector
from .csv_connector_async import AsyncCsvConnector
from typing import List, Dict, Any


@register_connector('google-sheets')
class AsyncGoogleSheetsConnector(AsyncDatabaseConnector):
    """
    Google Sheets connector — same S3-backed config as CSV.
    After import, config has {files: [...], spreadsheet_url, spreadsheet_id}.
    Delegates all query/schema/test operations to AsyncCsvConnector.
    """

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self._csv_connector = AsyncCsvConnector(name, config)

    async def get_engine(self):
        return await self._csv_connector.get_engine()

    async def test_connection(self) -> dict:
        return await self._csv_connector.test_connection()

    async def _fetch_schema(self) -> List[Dict[str, Any]]:
        return await self._csv_connector._fetch_schema()

    def validate_config(self) -> dict:
        return self._csv_connector.validate_config()

    async def close(self):
        await self._csv_connector.close()
        await super().close()
