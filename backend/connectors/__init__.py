from .base import AsyncDatabaseConnector

# Connector registry will be populated as we import concrete implementations
CONNECTOR_REGISTRY = {}


def register_connector(connector_type: str):
    """Decorator to register a connector type"""
    def decorator(cls):
        CONNECTOR_REGISTRY[connector_type] = cls
        return cls
    return decorator


def get_async_connector(name: str, conn_type: str, config: dict) -> AsyncDatabaseConnector:
    """Factory function to create async connector instances"""
    if conn_type not in CONNECTOR_REGISTRY:
        raise ValueError(f"Unsupported connection type: {conn_type}")

    connector_class = CONNECTOR_REGISTRY[conn_type]
    connector = connector_class(name, config)
    # Store the connection type on the instance for later retrieval
    connector.conn_type = conn_type
    return connector


# Import sync connectors first (needed by async wrappers for DuckDB and BigQuery)
from .duckdb_connector import DuckDBConnector  # noqa: E402, F401
from .bigquery_connector import BigQueryConnector  # noqa: E402, F401

# Import async connectors to trigger registration
from .postgres_connector_async import AsyncPostgresConnector  # noqa: E402, F401
from .duckdb_connector_async import AsyncDuckDBConnector  # noqa: E402, F401
from .bigquery_connector_async import AsyncBigQueryConnector  # noqa: E402, F401
from .csv_connector_async import AsyncCsvConnector  # noqa: E402, F401
from .google_sheets_connector_async import AsyncGoogleSheetsConnector  # noqa: E402, F401
