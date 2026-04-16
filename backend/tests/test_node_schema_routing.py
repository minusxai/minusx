"""
Tests for the Node.js-first routing architecture:

  - NODE_HANDLED_TYPES contains the expected connection types
  - duckdb, csv, and google-sheets are NOT in the connector registry
  - connection_manager.get_or_initialize_connection rejects NODE_HANDLED_TYPES
  - Python HTTP endpoints return 422 for NODE_HANDLED_TYPES
"""

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from connectors import CONNECTOR_REGISTRY
from main import app, NODE_HANDLED_TYPES
from connection_manager import ConnectionManager


client = TestClient(app)


# ─── NODE_HANDLED_TYPES ───────────────────────────────────────────────────────

class TestNodeHandledTypes:
    def test_contains_csv(self):
        assert 'csv' in NODE_HANDLED_TYPES

    def test_contains_google_sheets(self):
        assert 'google-sheets' in NODE_HANDLED_TYPES

    def test_contains_duckdb(self):
        assert 'duckdb' in NODE_HANDLED_TYPES

    def test_does_not_contain_bigquery(self):
        assert 'bigquery' not in NODE_HANDLED_TYPES

    def test_does_not_contain_postgresql(self):
        assert 'postgresql' not in NODE_HANDLED_TYPES

    def test_does_not_contain_athena(self):
        assert 'athena' not in NODE_HANDLED_TYPES

    def test_is_frozenset(self):
        assert isinstance(NODE_HANDLED_TYPES, frozenset)


# ─── Connector registry ───────────────────────────────────────────────────────

class TestConnectorRegistry:
    """Node-handled types must have NO Python connector."""

    def test_duckdb_not_in_registry(self):
        assert 'duckdb' not in CONNECTOR_REGISTRY

    def test_csv_not_in_registry(self):
        assert 'csv' not in CONNECTOR_REGISTRY

    def test_google_sheets_not_in_registry(self):
        assert 'google-sheets' not in CONNECTOR_REGISTRY

    def test_bigquery_in_registry(self):
        assert 'bigquery' in CONNECTOR_REGISTRY

    def test_postgresql_in_registry(self):
        assert 'postgresql' in CONNECTOR_REGISTRY

    def test_athena_in_registry(self):
        assert 'athena' in CONNECTOR_REGISTRY


# ─── HTTP endpoint guards ─────────────────────────────────────────────────────

class TestInitializeEndpointGuard:
    """POST /api/connections/{name}/initialize must return 422 for NODE_HANDLED_TYPES."""

    def test_rejects_csv(self):
        resp = client.post('/api/connections/my-conn/initialize',
                           json={'type': 'csv', 'config': {}})
        assert resp.status_code == 422
        assert 'Node.js' in resp.json()['detail']

    def test_rejects_google_sheets(self):
        resp = client.post('/api/connections/gs/initialize',
                           json={'type': 'google-sheets', 'config': {}})
        assert resp.status_code == 422

    def test_rejects_duckdb(self):
        resp = client.post('/api/connections/db/initialize',
                           json={'type': 'duckdb', 'config': {}})
        assert resp.status_code == 422


class TestSchemaEndpointGuard:
    """POST /api/connections/{name}/schema must return 422 for NODE_HANDLED_TYPES."""

    def test_rejects_csv(self):
        resp = client.post('/api/connections/my-conn/schema',
                           json={'type': 'csv', 'config': {}})
        assert resp.status_code == 422
        assert 'Node.js' in resp.json()['detail']

    def test_rejects_google_sheets(self):
        resp = client.post('/api/connections/gs/schema',
                           json={'type': 'google-sheets', 'config': {}})
        assert resp.status_code == 422

    def test_rejects_duckdb(self):
        resp = client.post('/api/connections/db/schema',
                           json={'type': 'duckdb', 'config': {}})
        assert resp.status_code == 422


class TestTestConnectionEndpointGuard:
    """POST /api/connections/test must return success=False for NODE_HANDLED_TYPES."""

    def test_rejects_csv(self):
        resp = client.post('/api/connections/test',
                           json={'type': 'csv', 'config': {}})
        assert resp.status_code == 200
        body = resp.json()
        assert body['success'] is False
        assert 'Node.js' in body['message']

    def test_rejects_google_sheets(self):
        resp = client.post('/api/connections/test',
                           json={'type': 'google-sheets', 'config': {}})
        assert resp.status_code == 200
        assert resp.json()['success'] is False

    def test_rejects_duckdb(self):
        resp = client.post('/api/connections/test',
                           json={'type': 'duckdb', 'config': {}})
        assert resp.status_code == 200
        assert resp.json()['success'] is False


# ─── ConnectionManager guard ─────────────────────────────────────────────────

class TestConnectionManagerNodeHandledGuard:
    """get_or_initialize_connection must reject NODE_HANDLED_TYPES."""

    @pytest.mark.asyncio
    async def test_rejects_csv_connection(self):
        manager = ConnectionManager()
        mock_fetch = AsyncMock(return_value={'type': 'csv', 'config': {'files': []}})

        with patch.object(manager, '_fetch_connection_config', mock_fetch):
            with pytest.raises(ValueError, match="Node.js"):
                await manager.get_or_initialize_connection('my-conn', company_id=1, session_token='tok', mode='org')

    @pytest.mark.asyncio
    async def test_rejects_google_sheets_connection(self):
        manager = ConnectionManager()
        mock_fetch = AsyncMock(return_value={'type': 'google-sheets', 'config': {'files': []}})

        with patch.object(manager, '_fetch_connection_config', mock_fetch):
            with pytest.raises(ValueError, match="Node.js"):
                await manager.get_or_initialize_connection('gs-conn', company_id=1, session_token='tok', mode='org')

    @pytest.mark.asyncio
    async def test_rejects_duckdb_connection(self):
        manager = ConnectionManager()
        mock_fetch = AsyncMock(return_value={'type': 'duckdb', 'config': {'file_path': 'x.duckdb'}})

        with patch.object(manager, '_fetch_connection_config', mock_fetch):
            with pytest.raises(ValueError, match="Node.js"):
                await manager.get_or_initialize_connection('ddb', company_id=1, session_token='tok', mode='org')

    @pytest.mark.asyncio
    async def test_error_includes_connection_name_and_type(self):
        manager = ConnectionManager()
        mock_fetch = AsyncMock(return_value={'type': 'csv', 'config': {}})

        with patch.object(manager, '_fetch_connection_config', mock_fetch):
            with pytest.raises(ValueError) as exc_info:
                await manager.get_or_initialize_connection('conn', company_id=1, session_token='tok', mode='org')
        error = str(exc_info.value)
        assert 'csv' in error
        assert 'conn' in error
