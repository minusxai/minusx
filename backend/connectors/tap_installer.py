"""
Dynamic tap/target installer with virtual environment isolation.

Handles installation of Singer taps and targets on-demand, creating isolated
virtual environments to avoid dependency conflicts.
"""
import subprocess
import sys
from pathlib import Path
from typing import Optional, Tuple
import json
import logging

logger = logging.getLogger(__name__)


class TapInstaller:
    """Manages dynamic installation of Singer taps and targets."""

    def __init__(self, taps_dir: Optional[Path] = None):
        """
        Initialize tap installer.

        Args:
            taps_dir: Directory for tap virtual environments (default: /tmp/atlas_taps)
        """
        if taps_dir is None:
            taps_dir = Path("/tmp/atlas_taps")

        self.taps_dir = taps_dir
        self.taps_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"[TapInstaller] Initialized with taps_dir: {self.taps_dir}")

    def ensure_package_installed(
        self,
        package_name: str,
        package_version: Optional[str] = None,
        executable_name: Optional[str] = None
    ) -> Path:
        """
        Ensure a Singer package (tap or target) is installed.

        Args:
            package_name: PyPI package name (e.g., "tap-facebook")
            package_version: Optional version constraint (e.g., "1.10.0")
            executable_name: Optional executable name (defaults to package_name)

        Returns:
            Path to the executable in the virtual environment
        """
        if executable_name is None:
            executable_name = package_name

        version_str = package_version or "latest"
        venv_name = f"{package_name}-{version_str}"
        venv_path = self.taps_dir / venv_name

        # Check if already installed
        executable_path = venv_path / "bin" / executable_name
        if executable_path.exists():
            logger.info(f"[TapInstaller] Package {package_name} already installed at {venv_path}")
            return executable_path

        logger.info(f"[TapInstaller] Installing {package_name} version {version_str}...")

        try:
            # Create virtual environment
            logger.debug(f"Creating venv at {venv_path}")
            subprocess.run(
                [sys.executable, "-m", "venv", str(venv_path)],
                check=True,
                capture_output=True,
                text=True
            )

            # Install package in isolated environment
            pip_path = venv_path / "bin" / "pip"

            # Upgrade pip first
            subprocess.run(
                [str(pip_path), "install", "--upgrade", "pip"],
                check=True,
                capture_output=True,
                text=True
            )

            package_spec = f"{package_name}=={package_version}" if package_version else package_name

            logger.debug(f"Installing {package_spec} with pip")
            result = subprocess.run(
                [str(pip_path), "install", package_spec],
                check=True,
                capture_output=True,
                text=True
            )
            logger.debug(f"Installation output: {result.stdout}")

            # Verify installation
            if not executable_path.exists():
                raise FileNotFoundError(
                    f"Package installed but executable not found at {executable_path}"
                )

            logger.info(f"[TapInstaller] Successfully installed {package_name} at {venv_path}")
            return executable_path

        except subprocess.CalledProcessError as e:
            logger.error(f"[TapInstaller] Installation failed: {e.stderr}")
            # Cleanup failed installation
            if venv_path.exists():
                import shutil
                shutil.rmtree(venv_path)
            raise RuntimeError(f"Failed to install {package_name}: {e.stderr}")

    def get_installed_packages(self) -> list[dict]:
        """
        List all installed Singer packages.

        Returns:
            List of dicts with package info (name, version, path)
        """
        installed = []

        if not self.taps_dir.exists():
            return installed

        for venv_dir in self.taps_dir.iterdir():
            if venv_dir.is_dir():
                parts = venv_dir.name.split('-', 1)
                if len(parts) == 2:
                    package_name, version = parts
                    installed.append({
                        "package": package_name,
                        "version": version,
                        "path": str(venv_dir)
                    })

        return installed

    def clear_cache(self, package_name: Optional[str] = None):
        """
        Clear cached installations.

        Args:
            package_name: Optional package name to clear (clears all if None)
        """
        import shutil

        if package_name is None:
            # Clear all
            if self.taps_dir.exists():
                shutil.rmtree(self.taps_dir)
                self.taps_dir.mkdir(parents=True, exist_ok=True)
            logger.info("[TapInstaller] Cleared all cached installations")
        else:
            # Clear specific package
            for venv_dir in self.taps_dir.iterdir():
                if venv_dir.name.startswith(f"{package_name}-"):
                    shutil.rmtree(venv_dir)
                    logger.info(f"[TapInstaller] Cleared cache for {package_name}")


# Global installer instance
_installer = None


def get_installer() -> TapInstaller:
    """Get or create global tap installer instance."""
    global _installer
    if _installer is None:
        _installer = TapInstaller()
    return _installer
