"""Async PostgreSQL connector using asyncpg"""

from .base import AsyncDatabaseConnector
from . import register_connector
from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
from sqlalchemy import text
from urllib.parse import quote_plus
from typing import List, Dict, Any


@register_connector('postgresql')
class AsyncPostgresConnector(AsyncDatabaseConnector):
    """PostgreSQL async database connector using asyncpg"""

    async def get_engine(self) -> AsyncEngine:
        if not self._engine:
            host = self.config.get('host', 'localhost')
            port = self.config.get('port', 5432)
            database = self.config.get('database')
            username = self.config.get('username')
            password = self.config.get('password', '')

            # Build PostgreSQL async connection URL using asyncpg driver
            if password:
                encoded_password = quote_plus(password)
                connection_url = f"postgresql+asyncpg://{username}:{encoded_password}@{host}:{port}/{database}"
            else:
                connection_url = f"postgresql+asyncpg://{username}@{host}:{port}/{database}"

            self._engine = create_async_engine(
                connection_url,
                pool_size=5,
                max_overflow=10,
                pool_pre_ping=True
            )
        return self._engine

    async def test_connection(self) -> dict:
        try:
            engine = await self.get_engine()
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return {"success": True, "message": "Connection successful"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    async def _fetch_schema(self) -> List[Dict[str, Any]]:
        """
        Get PostgreSQL schema using information_schema.
        Returns list of schemas with their tables and columns.
        Filters out system schemas (pg_catalog, information_schema).
        """
        engine = await self.get_engine()
        schemas = []

        async with engine.connect() as conn:
            # Get all schemas, tables, and columns in one query
            query = text("""
                SELECT
                    table_schema,
                    table_name,
                    column_name,
                    data_type
                FROM information_schema.columns
                WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                ORDER BY table_schema, table_name, ordinal_position
            """)

            result = await conn.execute(query)
            rows = result.fetchall()

            # Organize results into nested structure
            schema_dict = {}
            for row in rows:
                table_schema, table_name, column_name, data_type = row

                # Initialize schema if not exists
                if table_schema not in schema_dict:
                    schema_dict[table_schema] = {}

                # Initialize table if not exists
                if table_name not in schema_dict[table_schema]:
                    schema_dict[table_schema][table_name] = []

                # Add column
                schema_dict[table_schema][table_name].append({
                    "name": column_name,
                    "type": data_type
                })

            # Convert to expected format
            for schema_name, tables_dict in schema_dict.items():
                tables = []
                for table_name, columns in tables_dict.items():
                    tables.append({
                        "table": table_name,
                        "columns": columns
                    })

                schemas.append({
                    "schema": schema_name,
                    "tables": tables
                })

        return schemas

    def validate_config(self):
        errors = []

        # Required fields
        if 'database' not in self.config or not self.config['database']:
            errors.append("database is required")

        if 'username' not in self.config or not self.config['username']:
            errors.append("username is required")

        # Password is optional (some PostgreSQL setups use trust auth, peer auth, etc.)

        # Optional fields with validation
        if 'port' in self.config:
            port = self.config['port']
            try:
                port_int = int(port)
                if port_int < 1 or port_int > 65535:
                    errors.append("port must be between 1 and 65535")
            except (ValueError, TypeError):
                errors.append("port must be a valid integer")

        return {"valid": len(errors) == 0, "errors": errors}
