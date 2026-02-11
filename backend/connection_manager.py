from typing import Dict, List, Optional
import httpx

from connectors.base import AsyncDatabaseConnector
from config import NEXTJS_URL


class ConnectionManager:
    """Manages database connections in-memory (stateless)"""

    def __init__(self):
        self._connections: Dict[str, AsyncDatabaseConnector] = {}

    def get_connection(self, name: str) -> AsyncDatabaseConnector:
        """Get a connection by name"""
        if name not in self._connections:
            available = list(self._connections.keys())
            raise ValueError(
                f"Connection '{name}' not initialized. "
                f"Available connections: {available}"
            )
        return self._connections[name]

    async def _fetch_connection_config(
        self,
        name: str,
        company_id: Optional[int] = None,
        session_token: Optional[str] = None,
        mode: Optional[str] = None
    ) -> dict:
        """
        Fetch connection configuration from Next.js internal API.

        Args:
            name: Connection name
            company_id: Company ID for multi-tenant isolation
            session_token: Session token from Next.js for authentication
            mode: Mode (org, tutorial, etc.) for mode-based isolation

        Returns: { type: str, config: dict }
        """
        url = f"{NEXTJS_URL}/api/internal/connections/{name}"

        # Prepare headers with session token, company_id, and mode
        headers = {}
        if session_token:
            headers['x-session-token'] = session_token
        if company_id is not None:
            headers['x-company-id'] = str(company_id)
        if mode:
            headers['x-mode'] = mode

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers, timeout=10.0)

                if response.status_code == 404:
                    raise ValueError(f"Connection '{name}' not found in database")

                if response.status_code != 200:
                    raise ValueError(f"Failed to fetch connection config: {response.status_code}")

                data = response.json()
                return data  # { type, config }

        except httpx.RequestError as e:
            raise ValueError(f"Failed to connect to Next.js API: {e}")

    async def get_or_initialize_connection(
        self,
        name: str,
        company_id: Optional[int] = None,
        session_token: Optional[str] = None,
        mode: Optional[str] = None
    ) -> AsyncDatabaseConnector:
        """
        Idempotent connection initialization.

        If connection exists in cache → return it
        If not → fetch config from Next.js → initialize → cache → return

        This is the primary method for query execution.

        Args:
            name: Connection name
            company_id: Company ID for multi-tenant isolation (REQUIRED for security)
            session_token: Session token for internal API authentication
            mode: Mode (org, tutorial, etc.) for mode-based isolation
        """
        # Check cache first
        if name in self._connections:
            return self._connections[name]

        # Not in cache - fetch config from Next.js
        print(f"[ConnectionManager] Initializing connection '{name}' for company {company_id} mode {mode} (fetching config from Next.js)")
        connection_data = await self._fetch_connection_config(name, company_id, session_token, mode)

        conn_type = connection_data['type']
        config = connection_data['config']

        # Import here to avoid circular dependency
        from connectors import get_async_connector

        # Create and validate connection
        connector = get_async_connector(name, conn_type, config)
        validation = connector.validate_config()
        if not validation['valid']:
            raise ValueError(f"Invalid connection config: {validation['errors']}")

        # Cache it
        self._connections[name] = connector
        print(f"[ConnectionManager] ✅ Initialized and cached connection '{name}' (type: {conn_type})")
        return connector

    def create_or_get_connection(self, name: str, conn_type: str, config: dict) -> AsyncDatabaseConnector:
        """
        Legacy method: Get existing connection from cache, or create and cache a new one.

        DEPRECATED: Use get_or_initialize_connection() for idempotent initialization.
        This method is kept for backwards compatibility with manual initialization.
        """
        if name in self._connections:
            return self._connections[name]

        # Import here to avoid circular dependency
        from connectors import get_async_connector

        # Create new connection
        connector = get_async_connector(name, conn_type, config)
        validation = connector.validate_config()
        if not validation['valid']:
            raise ValueError(f"Invalid connection config: {validation['errors']}")

        # Cache it
        self._connections[name] = connector
        print(f"[ConnectionManager] Cached new connection '{name}' (type: {conn_type})")
        return connector

    def list_connections(self) -> List[str]:
        """List all initialized connection names"""
        return list(self._connections.keys())

    async def close_all(self):
        """Close all connections"""
        for conn in self._connections.values():
            await conn.close()
        self._connections.clear()


# Global instance
connection_manager = ConnectionManager()
