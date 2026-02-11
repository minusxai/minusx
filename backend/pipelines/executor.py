"""
Singer tap-to-target pipeline executor (without Meltano CLI).
"""
import subprocess
import tempfile
import json
import os
from typing import Dict, Any
from datetime import datetime

from .target_mapper import generate_target_config
from .errors import TapExecutionError, TargetExecutionError
from connectors.tap_installer import get_installer
from connectors.tap_registry import get_tap_info, get_target_info, get_target_for_connection_type


class PipelineExecutor:
    """
    Executes Singer tap-to-target pipelines without Meltano CLI.
    """

    def __init__(self, pipeline_config: Dict[str, Any], connection_manager):
        """
        Initialize pipeline executor.

        Args:
            pipeline_config: Pipeline configuration with tap and target config
            connection_manager: Connection manager instance to fetch connections
        """
        self.pipeline_config = pipeline_config
        self.connection_manager = connection_manager
        self.tap_config = pipeline_config['tap']['config']
        self.target_ref = pipeline_config['target']
        self.temp_files = []  # Track temp files for cleanup

    def execute(self) -> Dict[str, Any]:
        """
        Execute the pipeline and return execution results.

        Returns:
            {
                "status": "success" | "failed",
                "records_processed": int,
                "duration_seconds": float,
                "tap_stderr": str,
                "target_stdout": str,
                "target_stderr": str,
                "error": Optional[str]
            }
        """
        start_time = datetime.now()

        try:
            # Step 1: Write tap config to temp file
            tap_config_file = self._write_temp_json(self.tap_config)

            # Step 2: Generate target config from connection
            target_config, target_temp_files = self._generate_target_config()
            self.temp_files.extend(target_temp_files)

            # Ensure database directory exists for DuckDB targets
            if target_config.get('path'):
                db_path = target_config['path']
                db_dir = os.path.dirname(db_path)
                if db_dir and not os.path.exists(db_dir):
                    os.makedirs(db_dir, exist_ok=True)

            target_config_file = self._write_temp_json(target_config)

            # Step 3: Execute tap -> target pipeline
            tap_stderr, target_stdout, target_stderr = self._run_pipeline(
                tap_config_file,
                target_config_file
            )

            # Step 4: Parse metrics from target output
            metrics = self._parse_metrics(target_stdout)

            # Step 5: Cleanup temp files
            self._cleanup()

            duration = (datetime.now() - start_time).total_seconds()

            return {
                "status": "success",
                "records_processed": metrics.get("records_written", 0),
                "duration_seconds": duration,
                "tap_stderr": tap_stderr,
                "target_stdout": target_stdout,
                "target_stderr": target_stderr,
                "error": None
            }

        except Exception as e:
            self._cleanup()
            duration = (datetime.now() - start_time).total_seconds()

            return {
                "status": "failed",
                "records_processed": 0,
                "duration_seconds": duration,
                "error": str(e),
                "tap_stderr": getattr(e, 'stderr', ''),
                "target_stdout": '',
                "target_stderr": ''
            }

    def _write_temp_json(self, data: Dict[str, Any]) -> str:
        """Write JSON data to temp file and track for cleanup."""
        fd, path = tempfile.mkstemp(suffix='.json', prefix='singer_')
        with os.fdopen(fd, 'w') as f:
            json.dump(data, f, indent=2)
        self.temp_files.append(path)
        return path

    def _generate_target_config(self) -> tuple[Dict[str, Any], list[str]]:
        """Generate target config from connection reference."""
        conn_name = self.target_ref['connection_name']
        schema = self.target_ref.get('schema', 'default')

        # Get connection from manager
        connector = self.connection_manager.get_connection(conn_name)
        if not connector:
            raise ValueError(f"Connection '{conn_name}' not found")

        # Get connection type and config
        connection_type = connector.conn_type
        connection_config = connector.config

        return generate_target_config(
            conn_name,
            connection_type,
            connection_config,
            schema
        )

    def _run_pipeline(
        self,
        tap_config_file: str,
        target_config_file: str
    ) -> tuple[str, str, str]:
        """
        Execute tap -> target pipeline using subprocess pipes with dynamic installation.

        Returns:
            (tap_stderr, target_stdout, target_stderr)
        """
        installer = get_installer()

        # Get tap name from pipeline config
        tap_name = self.pipeline_config['tap']['name']

        # Get tap info from registry and install dynamically
        tap_info = get_tap_info(tap_name)
        if not tap_info:
            raise ValueError(f"Tap '{tap_name}' not found in registry")

        tap_executable = installer.ensure_package_installed(
            tap_info.package,
            tap_info.version,
            tap_info.executable
        )

        # Start tap process
        tap_cmd = [str(tap_executable), "--config", tap_config_file]
        tap_process = subprocess.Popen(
            tap_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # Get connection type to determine target
        conn_name = self.target_ref['connection_name']
        connector = self.connection_manager.get_connection(conn_name)
        connection_type = connector.conn_type

        # Get target info from registry
        target_name = get_target_for_connection_type(connection_type)
        if not target_name:
            raise ValueError(f"No target found for connection type '{connection_type}'")

        target_info = get_target_info(target_name)
        if not target_info:
            raise ValueError(f"Target '{target_name}' not found in registry")

        # Install target dynamically
        target_executable = installer.ensure_package_installed(
            target_info.package,
            target_info.version,
            target_info.executable
        )

        # Start target process with tap stdout as stdin
        target_cmd = [str(target_executable), "--config", target_config_file]
        target_process = subprocess.Popen(
            target_cmd,
            stdin=tap_process.stdout,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # Close tap stdout in parent to allow tap to receive SIGPIPE
        if tap_process.stdout:
            tap_process.stdout.close()

        # Wait for both processes to complete (with timeout)
        try:
            target_stdout, target_stderr = target_process.communicate(timeout=600)  # 10 min timeout
            _, tap_stderr = tap_process.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            tap_process.kill()
            target_process.kill()
            raise RuntimeError("Pipeline execution timed out")

        # Check return codes
        if tap_process.returncode != 0:
            raise TapExecutionError(
                f"Tap failed with code {tap_process.returncode}",
                tap_stderr,
                tap_process.returncode
            )

        if target_process.returncode != 0:
            raise TargetExecutionError(
                f"Target failed with code {target_process.returncode}",
                target_stderr,
                target_process.returncode
            )

        return tap_stderr, target_stdout, target_stderr

    def _parse_metrics(self, target_stdout: str) -> Dict[str, int]:
        """
        Parse Singer STATE messages from target output to extract metrics.

        Singer targets output JSON lines including STATE messages with bookmarks.
        """
        metrics = {"records_written": 0}

        for line in target_stdout.split('\n'):
            if not line.strip():
                continue

            try:
                msg = json.loads(line)
                if msg.get("type") == "STATE":
                    # STATE messages contain bookmarks with record counts
                    bookmarks = msg.get("value", {}).get("bookmarks", {})
                    for stream, bookmark in bookmarks.items():
                        if "record_count" in bookmark:
                            metrics["records_written"] += bookmark["record_count"]
            except json.JSONDecodeError:
                continue

        return metrics

    def _cleanup(self):
        """Remove temporary files."""
        for path in self.temp_files:
            try:
                if os.path.exists(path):
                    os.unlink(path)
            except Exception:
                pass
