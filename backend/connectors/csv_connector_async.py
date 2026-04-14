"""Async CSV connector — pure in-memory DuckDB backed by S3 remote files.

No local files are created or read. DuckDB is used only as a query engine:
 - INSTALL/LOAD httpfs → S3 access
 - CREATE SCHEMA + CREATE VIEW per registered file
 - StaticPool → one in-memory database per connector instance (views persist)

Config shape:
    {
      "files": [
        {
          "table_name": "orders",
          "schema_name": "public",
          "s3_key": "{companyId}/csvs/org/{conn}/{uuid}.csv",
          "file_format": "csv",   # or "parquet"
          "filename": "orders.csv",
          "row_count": 5000,
          "columns": [{"name": "id", "type": "INTEGER"}, ...]
        },
        ...
      ]
    }

Query syntax: SELECT * FROM public.orders
"""

import asyncio
from typing import List, Dict, Any

from sqlalchemy import create_engine, event, text
from sqlalchemy.pool import StaticPool

from .base import AsyncDatabaseConnector
from . import register_connector
from config import (
    OBJECT_STORE_BUCKET,
    OBJECT_STORE_REGION,
    OBJECT_STORE_ACCESS_KEY_ID,
    OBJECT_STORE_SECRET_ACCESS_KEY,
    OBJECT_STORE_ENDPOINT,
)


def _detect_format(filename: str) -> str:
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    return 'parquet' if ext in ('parquet', 'pq') else 'csv'


@register_connector('csv')
class AsyncCsvConnector(AsyncDatabaseConnector):
    """
    In-memory DuckDB connector that reads CSV/Parquet files from S3.

    One in-memory DuckDB per connector instance. Views are created once
    on first engine access and persist for the lifetime of the engine.
    To add/update files, invalidate the connector via the connection manager
    (triggers engine disposal + recreation from updated config).
    """

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self._engine = None

    def _create_engine_sync(self):
        files = self.config.get('files', [])
        bucket = OBJECT_STORE_BUCKET or ''

        engine = create_engine(
            "duckdb:///:memory:",
            poolclass=StaticPool,
            connect_args={"check_same_thread": False},
        )

        @event.listens_for(engine, "connect")
        def _setup(dbapi_conn, _record):
            dbapi_conn.execute("INSTALL httpfs; LOAD httpfs;")
            dbapi_conn.execute(f"SET s3_region='{OBJECT_STORE_REGION}'")
            dbapi_conn.execute(f"SET s3_access_key_id='{OBJECT_STORE_ACCESS_KEY_ID or ''}'")
            dbapi_conn.execute(f"SET s3_secret_access_key='{OBJECT_STORE_SECRET_ACCESS_KEY or ''}'")
            if OBJECT_STORE_ENDPOINT:
                dbapi_conn.execute(f"SET s3_endpoint='{OBJECT_STORE_ENDPOINT}'")
                dbapi_conn.execute("SET s3_url_style='path'")

            schemas_created: set = set()
            for file_info in files:
                schema = file_info.get('schema_name', 'public')
                table = file_info['table_name']
                s3_key = file_info['s3_key']
                fmt = file_info.get('file_format') or _detect_format(
                    file_info.get('filename', s3_key)
                )
                s3_url = f"s3://{bucket}/{s3_key}"

                if schema not in schemas_created:
                    dbapi_conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
                    schemas_created.add(schema)

                if fmt == 'parquet':
                    reader = f"read_parquet('{s3_url}')"
                else:
                    reader = f"read_csv_auto('{s3_url}')"

                dbapi_conn.execute(
                    f'CREATE VIEW "{schema}"."{table}" AS SELECT * FROM {reader}'
                )

        return engine

    async def get_engine(self):
        if not self._engine:
            self._engine = await asyncio.to_thread(self._create_engine_sync)
        return self._engine

    async def test_connection(self) -> dict:
        files = self.config.get('files', [])
        if not files:
            return {
                "success": False,
                "message": "No files registered. Upload CSV or Parquet files first.",
            }
        if not OBJECT_STORE_BUCKET:
            return {
                "success": False,
                "message": "OBJECT_STORE_BUCKET is not configured.",
            }
        try:
            engine = await self.get_engine()
            return await asyncio.to_thread(self._run_test_query, engine)
        except Exception as e:
            return {"success": False, "message": str(e)}

    def _run_test_query(self, engine) -> dict:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"success": True, "message": "Connection successful"}

    async def _fetch_schema(self) -> List[Dict[str, Any]]:
        """Build schema from config — no DB round-trip needed, and ensures
        each connection only exposes its own tables."""
        files = self.config.get('files', [])
        schema_dict: Dict[str, List[Dict[str, Any]]] = {}
        for file_info in files:
            schema = file_info.get('schema_name', 'public')
            if schema not in schema_dict:
                schema_dict[schema] = []
            schema_dict[schema].append({
                "table": file_info['table_name'],
                "columns": file_info.get('columns', []),
            })
        return [
            {"schema": schema, "tables": tables}
            for schema, tables in schema_dict.items()
        ]

    def validate_config(self) -> dict:
        errors = []
        if not self.config.get('files'):
            errors.append("No files registered in this connection")
        if not OBJECT_STORE_BUCKET:
            errors.append("OBJECT_STORE_BUCKET env var is not configured")
        return {"valid": len(errors) == 0, "errors": errors}

    async def close(self):
        if self._engine:
            self._engine.dispose()
            self._engine = None
        await super().close()
