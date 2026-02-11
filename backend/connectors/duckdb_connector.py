from .base import DatabaseConnector
from . import register_connector
from sqlalchemy import create_engine, inspect, text, event
from pathlib import Path
from config import BASE_DUCKDB_DATA_PATH


@register_connector('duckdb')
class DuckDBConnector(DatabaseConnector):
    """DuckDB database connector"""
    skip_schemas = ['system', 'temp']

    def get_engine(self):
        if not self._engine:
            # Get file path from config
            file_path = self.config.get('file_path')

            # Resolve path relative to BASE_DUCKDB_DATA_PATH if relative
            if Path(file_path).is_absolute():
                resolved_path = file_path
            else:
                resolved_path = str(Path(BASE_DUCKDB_DATA_PATH) / file_path)

            # Create engine with resolved path
            self._engine = create_engine(f"duckdb:///{resolved_path}", connect_args={"read_only": True})

            # Set default schema to main after connection
            @event.listens_for(self._engine, "connect")
            def set_search_path(dbapi_conn, connection_record):
                cursor = dbapi_conn.cursor()
                # Get the attached database name and set search path
                cursor.execute("SELECT database_name FROM duckdb_databases() WHERE database_name != 'system' AND database_name != 'temp' LIMIT 1")
                result = cursor.fetchone()
                if result:
                    db_name = result[0]
                    cursor.execute(f"SET search_path = '{db_name}.main'")
                cursor.close()
        return self._engine

    def test_connection(self):
        try:
            engine = self.get_engine()
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return {"success": True, "message": "Connection successful"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def get_schema(self):
        engine = self.get_engine()

        # Use DuckDB's information schema directly instead of SQLAlchemy inspector
        # to avoid PostgreSQL compatibility issues with pg_catalog tables
        schemas = []

        with engine.connect() as conn:
            # Get all schemas, tables, and columns in one query
            query = text("""
                SELECT
                    table_schema,
                    table_name,
                    column_name,
                    data_type
                FROM information_schema.columns
                WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
                ORDER BY table_schema, table_name, ordinal_position
            """)

            result = conn.execute(query)
            rows = result.fetchall()

            # Organize results into nested structure
            schema_dict = {}
            for row in rows:
                table_schema, table_name, column_name, data_type = row

                # Handle schema names with database prefix
                if "." in table_schema:
                    schema_a, schema_b = table_schema.split(".", 1)
                    if schema_a in self.skip_schemas:
                        continue
                    display_schema = schema_b
                else:
                    if table_schema in self.skip_schemas:
                        continue
                    display_schema = table_schema

                # Initialize schema if not exists
                if display_schema not in schema_dict:
                    schema_dict[display_schema] = {}

                # Initialize table if not exists
                if table_name not in schema_dict[display_schema]:
                    schema_dict[display_schema][table_name] = []

                # Add column
                schema_dict[display_schema][table_name].append({
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
        if 'file_path' not in self.config:
            errors.append("file_path is required")
        else:
            # Validate that resolved path is valid
            file_path = self.config.get('file_path')
            if Path(file_path).is_absolute():
                resolved_path = file_path
            else:
                resolved_path = str(Path(BASE_DUCKDB_DATA_PATH) / file_path)

            # Check if parent directory exists (file itself may not exist yet)
            parent_path = Path(resolved_path).parent
            if parent_path and not parent_path.exists():
                errors.append(f"Parent directory does not exist: {parent_path}")

        return {"valid": len(errors) == 0, "errors": errors}
