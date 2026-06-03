"""
AgentTrace Python SDK
Drop-in tracing and observability for AI agents.
"""

from .core import (
    AgentTrace,
    VERSION,
    PACKAGE_NAME,
    init,
    get_agent_trace,
    trace,
    score,
    evaluate,
    evaluate_trace,
)
from .types import (
    Trace,
    Run,
    TokenUsage,
    ToolCall,
    TraceConfig,
    TraceFilter,
    TraceStats,
    ExportFormat,
    Scorer,
    ScorerResult,
    EvaluateOptions,
)

__all__ = [
    "AgentTrace",
    "init",
    "trace",
    "get_agent_trace",
    "score",
    "evaluate",
    "evaluate_trace",
    "VERSION",
    "PACKAGE_NAME",
    # types
    "Trace",
    "Run",
    "TokenUsage",
    "ToolCall",
    "TraceConfig",
    "TraceFilter",
    "TraceStats",
    "ExportFormat",
    "Scorer",
    "ScorerResult",
    "EvaluateOptions",
]
