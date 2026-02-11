"""
Registry of validated Singer taps and targets.

Defines which Singer packages are approved for dynamic installation,
including version constraints and metadata.
"""
from typing import Dict, Optional, Any


class TapRegistryEntry:
    """Metadata for a registered Singer tap."""

    def __init__(
        self,
        package: str,
        version: str,
        executable: Optional[str] = None,
        verified: bool = False,
        description: Optional[str] = None,
        config_schema: Optional[Dict[str, Any]] = None
    ):
        """
        Initialize tap registry entry.

        Args:
            package: PyPI package name
            version: Recommended version
            executable: Executable name (defaults to package name)
            verified: Whether package has been manually verified
            description: Human-readable description
            config_schema: JSON schema for config validation (future use)
        """
        self.package = package
        self.version = version
        self.executable = executable or package
        self.verified = verified
        self.description = description
        self.config_schema = config_schema

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "package": self.package,
            "version": self.version,
            "executable": self.executable,
            "verified": self.verified,
            "description": self.description,
            "config_schema": self.config_schema
        }


class TargetRegistryEntry:
    """Metadata for a registered Singer target."""

    def __init__(
        self,
        package: str,
        version: str,
        executable: Optional[str] = None,
        verified: bool = False,
        description: Optional[str] = None,
        supports_connection_types: Optional[list[str]] = None
    ):
        """
        Initialize target registry entry.

        Args:
            package: PyPI package name
            version: Recommended version
            executable: Executable name (defaults to package name)
            verified: Whether package has been manually verified
            description: Human-readable description
            supports_connection_types: List of connection types this target supports
        """
        self.package = package
        self.version = version
        self.executable = executable or package
        self.verified = verified
        self.description = description
        self.supports_connection_types = supports_connection_types or []

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "package": self.package,
            "version": self.version,
            "executable": self.executable,
            "verified": self.verified,
            "description": self.description,
            "supports_connection_types": self.supports_connection_types
        }


# Registry of validated Singer taps
TAP_REGISTRY: Dict[str, TapRegistryEntry] = {
    "tap-facebook": TapRegistryEntry(
        package="meltano-tap-facebook",
        version="0.9.0",
        executable="tap-facebook",  # Executable name differs from package name
        verified=True,
        description="Facebook Marketing API tap for ads data (MeltanoLabs - modern, Python 3.9+)",
        config_schema={
            "type": "object",
            "required": ["access_token", "account_id"],
            "properties": {
                "access_token": {"type": "string"},
                "account_id": {"type": "string"},
                "start_date": {"type": "string"},
                "end_date": {"type": "string"},
                "include_deleted": {"type": "boolean"},
                "insights_buffer_days": {"type": "integer"}
            }
        }
    ),
    # Future taps (examples):
    # "tap-google-ads": TapRegistryEntry(
    #     package="tap-google-ads",
    #     version="2.1.0",
    #     verified=False,
    #     description="Google Ads API tap"
    # ),
    # "tap-google-analytics": TapRegistryEntry(
    #     package="tap-google-analytics",
    #     version="1.0.0",
    #     verified=False,
    #     description="Google Analytics API tap"
    # ),
}

# Registry of validated Singer targets
TARGET_REGISTRY: Dict[str, TargetRegistryEntry] = {
    "target-postgres": TargetRegistryEntry(
        package="pipelinewise-target-postgres",
        version="2.0.0",
        executable="target-postgres",
        verified=True,
        description="PostgreSQL target for Singer taps",
        supports_connection_types=["postgres"]
    ),
    "target-duckdb": TargetRegistryEntry(
        package="target-duckdb",
        version="0.8.0",
        executable="target-duckdb",
        verified=False,
        description="DuckDB target for Singer taps",
        supports_connection_types=["duckdb"]
    ),
    "target-bigquery": TargetRegistryEntry(
        package="target-bigquery",
        version="0.10.0",
        executable="target-bigquery",
        verified=False,
        description="Google BigQuery target for Singer taps",
        supports_connection_types=["bigquery"]
    ),
}


def get_tap_info(tap_name: str) -> Optional[TapRegistryEntry]:
    """
    Get tap registry entry by name.

    Args:
        tap_name: Tap name (e.g., "tap-facebook")

    Returns:
        TapRegistryEntry if found, None otherwise
    """
    return TAP_REGISTRY.get(tap_name)


def get_target_info(target_name: str) -> Optional[TargetRegistryEntry]:
    """
    Get target registry entry by name.

    Args:
        target_name: Target name (e.g., "target-postgres")

    Returns:
        TargetRegistryEntry if found, None otherwise
    """
    return TARGET_REGISTRY.get(target_name)


def get_target_for_connection_type(connection_type: str) -> Optional[str]:
    """
    Get recommended target for a connection type.

    Args:
        connection_type: Connection type (e.g., "duckdb", "bigquery")

    Returns:
        Target name (e.g., "target-duckdb") if found, None otherwise
    """
    for target_name, entry in TARGET_REGISTRY.items():
        if connection_type in entry.supports_connection_types:
            return target_name
    return None


def list_all_taps() -> Dict[str, Dict[str, Any]]:
    """List all registered taps with metadata."""
    return {name: entry.to_dict() for name, entry in TAP_REGISTRY.items()}


def list_all_targets() -> Dict[str, Dict[str, Any]]:
    """List all registered targets with metadata."""
    return {name: entry.to_dict() for name, entry in TARGET_REGISTRY.items()}


def is_tap_verified(tap_name: str) -> bool:
    """Check if tap is verified for use."""
    entry = get_tap_info(tap_name)
    return entry.verified if entry else False


def is_target_verified(target_name: str) -> bool:
    """Check if target is verified for use."""
    entry = get_target_info(target_name)
    return entry.verified if entry else False
