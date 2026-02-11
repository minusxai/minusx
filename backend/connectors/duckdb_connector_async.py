"""Async wrapper for DuckDB connector using thread pool"""

from .base import AsyncDatabaseConnector
from . import register_connector
from .duckdb_connector import DuckDBConnector
from typing import List, Dict, Any
import asyncio


@register_connector('duckdb')
class AsyncDuckDBConnector(AsyncDatabaseConnector):
    """DuckDB async wrapper using thread pool execution"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self._sync_connector = DuckDBConnector(name, config)

    async def get_engine(self):
        """Wrap sync get_engine in thread pool"""
        return await asyncio.to_thread(self._sync_connector.get_engine)

    async def test_connection(self) -> dict:
        """Wrap sync test_connection in thread pool"""
        return await asyncio.to_thread(self._sync_connector.test_connection)

    async def _fetch_schema(self) -> List[Dict[str, Any]]:
        """Wrap sync get_schema in thread pool"""
        return await asyncio.to_thread(self._sync_connector.get_schema)

    def validate_config(self) -> dict:
        """Delegate to sync connector (no I/O)"""
        return self._sync_connector.validate_config()

    async def close(self):
        """Close sync connector"""
        await asyncio.to_thread(self._sync_connector.close)
