"""
AgentTrace -- Core Types
Open source AI agent observability
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Optional


Status = Literal["success", "failure", "error", "timeout"]
RunStatus = Literal["running", "success", "failure", "error"]
ExportFormat = Literal["json", "csv"]


@dataclass
class ToolCall:
    """A single tool call within an agent run."""

    id: str
    name: str
    input: Any = None
    output: Any = None
    latency_ms: int = 0
    success: bool = True
    error: Optional[str] = None
    timestamp: int = 0


@dataclass
class TokenUsage:
    """Token usage for a single LLM call."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    model: Optional[str] = None
    provider: Optional[str] = None


@dataclass
class Trace:
    """A single trace (one operation within an agent run)."""

    id: str
    run_id: str
    name: str
    status: Status
    input: Any = None
    output: Any = None
    tokens: TokenUsage = field(default_factory=TokenUsage)
    tool_calls: list[ToolCall] = field(default_factory=list)
    latency_ms: int = 0
    cost_usd: float = 0.0
    error: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: int = 0
    updated_at: int = 0


@dataclass
class Run:
    """Summary of an agent run (collection of traces)."""

    id: str
    name: str
    status: RunStatus = "running"
    trace_count: int = 0
    total_tokens: TokenUsage = field(default_factory=TokenUsage)
    total_tool_calls: int = 0
    total_latency_ms: int = 0
    total_cost_usd: float = 0.0
    error_count: int = 0
    started_at: int = 0
    completed_at: Optional[int] = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class TraceConfig:
    """Configuration for the trace collector."""

    db_path: Optional[str] = None
    max_traces: Optional[int] = None
    auto_cleanup: Optional[bool] = None
    cost_calculator: Optional[Callable[[TokenUsage, Optional[str]], float]] = None
    hallucination_detector: Optional[Callable[[Any, Optional[Any]], bool]] = None
    silent: Optional[bool] = None


@dataclass
class TraceFilter:
    """Filter options for querying traces."""

    run_id: Optional[str] = None
    status: Optional[list[Status]] = None
    name: Optional[str] = None
    from_date: Optional[int] = None
    to_date: Optional[int] = None
    min_cost: Optional[float] = None
    max_cost: Optional[float] = None
    min_latency: Optional[int] = None
    max_latency: Optional[int] = None
    limit: Optional[int] = None
    offset: Optional[int] = None


@dataclass
class TraceStats:
    """Summary statistics."""

    total_runs: int = 0
    total_traces: int = 0
    success_rate: float = 0.0
    avg_latency_ms: float = 0.0
    total_cost_usd: float = 0.0
    total_tokens: int = 0
    avg_tokens_per_trace: float = 0.0
    top_tools: list[dict[str, Any]] = field(default_factory=list)
    top_errors: list[dict[str, Any]] = field(default_factory=list)


# For type hints on cost calc etc.
CostCalculator = Callable[[TokenUsage, Optional[str]], float]
HallucinationDetector = Callable[[Any, Optional[Any]], bool]
