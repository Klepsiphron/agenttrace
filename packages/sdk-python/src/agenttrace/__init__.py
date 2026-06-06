"""
AgentTrace Python SDK
Drop-in tracing and observability for AI agents.
"""

from .core import (
    AgentTrace,
    AgentUsageTracker,
    VERSION,
    PACKAGE_NAME,
    init,
    get_agent_trace,
    trace,
    score,
    evaluate,
    evaluate_trace,
)
from .storage import TraceStorage
from .types import (
    AgentUsageFilter,
    AgentUsageRecord,
    CostBreakdown,
    EvaluateOptions,
    ExportFormat,
    Run,
    RunStatus,
    Scorer,
    ScorerResult,
    TokenUsage,
    ToolCall,
    Trace,
    TraceConfig,
    TraceFilter,
    TraceStats,
    UsageStats,
)

__all__ = [
    "AgentTrace",
    "AgentUsageTracker",
    "TraceStorage",
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
    "AgentUsageRecord",
    "AgentUsageFilter",
    "UsageStats",
    "CostBreakdown",
    "RunStatus",
]
