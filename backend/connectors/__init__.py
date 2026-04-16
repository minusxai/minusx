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


# Import sync connectors (BigQuery wraps one)
from .bigquery_connector import BigQueryConnector  # noqa: E402, F401

# Import async connectors to trigger registration.
# Note: duckdb, csv, and google-sheets are intentionally absent — they are all
# handled exclusively by Node.js. Python has no connector for these types;
# all Python endpoints guard against NODE_HANDLED_TYPES before calling get_async_connector.
from .postgres_connector_async import AsyncPostgresConnector  # noqa: E402, F401
from .bigquery_connector_async import AsyncBigQueryConnector  # noqa: E402, F401
from .athena_connector import AthenaConnector  # noqa: E402, F401
from .athena_connector_async import AsyncAthenaConnector  # noqa: E402, F401
