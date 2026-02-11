"""
Custom exceptions for pipeline execution.
"""


class PipelineError(Exception):
    """Base exception for pipeline errors."""
    pass


class TapConfigError(PipelineError):
    """Invalid tap configuration."""
    pass


class TargetConfigError(PipelineError):
    """Invalid target configuration."""
    pass


class TapExecutionError(PipelineError):
    """Tap execution failed."""
    def __init__(self, message: str, stderr: str, returncode: int):
        super().__init__(message)
        self.stderr = stderr
        self.returncode = returncode


class TargetExecutionError(PipelineError):
    """Target execution failed."""
    def __init__(self, message: str, stderr: str, returncode: int):
        super().__init__(message)
        self.stderr = stderr
        self.returncode = returncode


class ConnectionNotFoundError(PipelineError):
    """Referenced connection not found."""
    pass
