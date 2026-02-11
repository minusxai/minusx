from abc import ABC, abstractmethod
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncEngine
from typing import List, Dict, Any
import asyncio
import time


class DatabaseConnector(ABC):
    """Base class for all database connectors (legacy sync interface)"""

    def __init__(self, name: str, config: dict):
        self.name = name
        self.config = config
        self._engine = None

    @abstractmethod
    def get_engine(self) -> Engine:
        """Return SQLAlchemy engine for this connection"""
        pass

    @abstractmethod
    def test_connection(self) -> dict:
        """Test if connection is valid. Returns {success: bool, message: str}"""
        pass

    @abstractmethod
    def get_schema(self) -> List[Dict[str, Any]]:
        """Get database schema (tables, columns, types)"""
        pass

    @abstractmethod
    def validate_config(self) -> dict:
        """Validate configuration. Returns {valid: bool, errors: List[str]}"""
        pass

    def close(self):
        """Close connection and clean up resources"""
        if self._engine:
            self._engine.dispose()
            self._engine = None


class AsyncDatabaseConnector(ABC):
    """Async base class for all database connectors"""

    def __init__(self, name: str, config: dict):
        self.name = name
        self.config = config
        self._engine: AsyncEngine | Engine | None = None
        self._schema_cache: List[Dict[str, Any]] | None = None
        self._schema_cache_time: float | None = None

    @abstractmethod
    async def get_engine(self):
        """Return SQLAlchemy engine (async or sync wrapped)"""
        pass

    @abstractmethod
    async def test_connection(self) -> dict:
        """Test connection. Returns {success: bool, message: str}"""
        pass

    @abstractmethod
    async def _fetch_schema(self) -> List[Dict[str, Any]]:
        """Internal method to fetch schema from database"""
        pass

    async def get_schema(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """Get database schema with caching (5-minute TTL)"""
        if not force_refresh and self._schema_cache and self._schema_cache_time:
            if time.time() - self._schema_cache_time < 300:  # 5 min TTL
                return self._schema_cache

        schema = await self._fetch_schema()
        self._schema_cache = schema
        self._schema_cache_time = time.time()
        return schema

    @abstractmethod
    def validate_config(self) -> dict:
        """Validate config synchronously. Returns {valid: bool, errors: List[str]}"""
        pass

    async def close(self):
        """Close connection and clean up resources"""
        if self._engine:
            if hasattr(self._engine, 'dispose'):
                await self._engine.dispose()
            self._engine = None

    async def __aenter__(self):
        await self.get_engine()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
        return False
