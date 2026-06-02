"""
AgentTrace -- Core SDK
Drop-in tracing for any AI agent (Python port)
"""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import Callable
from typing import Any, Optional, TypeVar, cast

from .storage import TraceStorage
from .types import (
    ExportFormat,
    HallucinationDetector,
    Run,
    RunStatus,
    Status,
    TokenUsage,
    ToolCall,
    Trace,
    TraceConfig,
    TraceFilter,
    TraceStats,
)

T = TypeVar("T")


# Default cost calculator (approximate 2026 pricing) -- matches TypeScript SDK
def _default_cost_calculator(tokens: TokenUsage, model: Optional[str] = None) -> float:
    rates: dict[str, dict[str, float]] = {
        "gpt-4o": {"prompt": 0.0025, "completion": 0.01},
        "gpt-4o-mini": {"prompt": 0.00015, "completion": 0.0006},
        "claude-sonnet-4": {"prompt": 0.003, "completion": 0.015},
        "claude-haiku-4": {"prompt": 0.00025, "completion": 0.00125},
        "gemini-2.0-flash": {"prompt": 0.0001, "completion": 0.0004},
        "llama-3.1-70b": {"prompt": 0.0009, "completion": 0.0009},
    }
    rate = rates.get(model or "", {"prompt": 0.001, "completion": 0.002})
    return (tokens.prompt_tokens * rate["prompt"] + tokens.completion_tokens * rate["completion"]) / 1000


def _normalize_config(c: Any) -> dict[str, Any]:
    if c is None:
        c = {}
    if isinstance(c, TraceConfig):
        c = {
            "db_path": c.db_path,
            "max_traces": c.max_traces,
            "auto_cleanup": c.auto_cleanup,
            "cost_calculator": c.cost_calculator,
            "hallucination_detector": c.hallucination_detector,
            "silent": c.silent,
        }
    if isinstance(c, dict):
        out: dict[str, Any] = {}
        for k, v in list(c.items()):
            if k == "dbPath":
                out["db_path"] = v
            elif k == "maxTraces":
                out["max_traces"] = v
            elif k == "autoCleanup":
                out["auto_cleanup"] = v
            elif k == "costCalculator":
                out["cost_calculator"] = v
            elif k == "hallucinationDetector":
                out["hallucination_detector"] = v
            else:
                out[k] = v
        return out
    return {}


class _TraceContext:
    """Internal context manager + decorator support for trace().

    Supports:
      with agent.trace("op") as t:
          ...
          t.set_output(val)
      @agent.trace("op")
      def fn(): ...
      result = agent.trace("op", lambda: compute())
    """

    def __init__(self, agent: AgentTrace, name: str, options: dict[str, Any]) -> None:
        self.agent = agent
        self.name = name
        self.options: dict[str, Any] = options
        self._start_time: int = 0
        self._result: Any = None
        self._error: Optional[str] = None
        self._status: Status = "success"
        self._output_set: bool = False
        self._trace_id: Optional[str] = None

    def __enter__(self) -> _TraceContext:
        self._start_time = int(time.time() * 1000)
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> bool:
        latency_ms = int(time.time() * 1000) - self._start_time
        if exc_val is not None:
            self._status = "error"
            self._error = str(exc_val)
        if not self._output_set:
            self._result = None if exc_val is not None else self._result
        self._record_trace(latency_ms)
        # Do not suppress exception
        return False

    async def __aenter__(self) -> _TraceContext:
        return self.__enter__()

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> bool:
        return self.__exit__(exc_type, exc_val, exc_tb)

    def set_output(self, output: Any) -> None:
        """Manually set the output for the trace (useful in context manager usage)."""
        self._result = output
        self._output_set = True

    def set_tokens(self, tokens: TokenUsage | dict[str, Any]) -> None:
        """Override tokens for this trace (before exit)."""
        self.options["tokens"] = tokens

    def set_metadata(self, metadata: dict[str, Any]) -> None:
        self.options["metadata"] = metadata

    def _record_trace(self, latency_ms: int) -> None:
        tok_raw = self.options.get("tokens") or {}
        if isinstance(tok_raw, TokenUsage):
            tokens = tok_raw
        else:
            tokens = TokenUsage(
                prompt_tokens=tok_raw.get("promptTokens", tok_raw.get("prompt_tokens", 0)),
                completion_tokens=tok_raw.get("completionTokens", tok_raw.get("completion_tokens", 0)),
                total_tokens=tok_raw.get("totalTokens", tok_raw.get("total_tokens", 0)),
                model=tok_raw.get("model") or self.options.get("model"),
                provider=tok_raw.get("provider") or self.options.get("provider"),
            )

        cost_usd = self.agent._cost_calculator(tokens, self.options.get("model"))

        trace_id = str(uuid.uuid4())
        run_id = self.agent._current_run_id or str(uuid.uuid4())

        tr = Trace(
            id=trace_id,
            run_id=run_id,
            name=self.name,
            status=self._status,
            input=self.options.get("input"),
            output=self._result,
            tokens=tokens,
            tool_calls=[],
            latency_ms=latency_ms,
            cost_usd=cost_usd,
            error=self._error,
            metadata=self.options.get("metadata") or {},
        )
        self.agent.storage.create_trace(tr)

        if self.agent.config.get("auto_cleanup", True):
            self.agent.storage.cleanup(self.agent.config.get("max_traces", 10000))

        self._trace_id = trace_id

    def __call__(self, fn: Callable[..., T]) -> Callable[..., T]:
        """Allow use as decorator when trace(name) is applied with @."""

        def wrapper(*args: Any, **kwargs: Any) -> T:
            start = int(time.time() * 1000)
            status: Status = "success"
            err: Optional[str] = None
            res: Any = None
            try:
                res = fn(*args, **kwargs)
                return res
            except Exception as e:
                err = str(e)
                status = "error"
                raise
            finally:
                latency_ms = int(time.time() * 1000) - start
                tok_raw = self.options.get("tokens") or {}
                if isinstance(tok_raw, TokenUsage):
                    tokens = tok_raw
                else:
                    tokens = TokenUsage(
                        prompt_tokens=tok_raw.get("promptTokens", tok_raw.get("prompt_tokens", 0)),
                        completion_tokens=tok_raw.get("completionTokens", tok_raw.get("completion_tokens", 0)),
                        total_tokens=tok_raw.get("totalTokens", tok_raw.get("total_tokens", 0)),
                        model=tok_raw.get("model") or self.options.get("model"),
                        provider=tok_raw.get("provider") or self.options.get("provider"),
                    )
                cost_usd = self.agent._cost_calculator(tokens, self.options.get("model"))
                trace_id = str(uuid.uuid4())
                run_id = self.agent._current_run_id or str(uuid.uuid4())
                tr = Trace(
                    id=trace_id,
                    run_id=run_id,
                    name=self.name,
                    status=status,
                    input=self.options.get("input"),
                    output=res,
                    tokens=tokens,
                    tool_calls=[],
                    latency_ms=latency_ms,
                    cost_usd=cost_usd,
                    error=err,
                    metadata=self.options.get("metadata") or {},
                )
                self.agent.storage.create_trace(tr)
                if self.agent.config.get("auto_cleanup", True):
                    self.agent.storage.cleanup(self.agent.config.get("max_traces", 10000))
                self._trace_id = trace_id

        # Preserve metadata
        wrapper.__name__ = getattr(fn, "__name__", "wrapped")
        wrapper.__doc__ = getattr(fn, "__doc__", None)
        wrapper.__module__ = getattr(fn, "__module__", None)
        return wrapper


class AgentTrace:
    """Main SDK class. Mirrors the TypeScript AgentTrace API closely."""

    def __init__(self, config: TraceConfig | dict[str, Any] | None = None) -> None:
        cfg = _normalize_config(config)
        self.config: dict[str, Any] = {
            "db_path": cfg.get("db_path") or "./agenttrace.db",
            "max_traces": cfg.get("max_traces") or 10000,
            "auto_cleanup": cfg.get("auto_cleanup", True),
            "silent": bool(cfg.get("silent", False)),
        }
        self._cost_calculator: Callable[[TokenUsage, Optional[str]], float] = (
            cfg.get("cost_calculator") or _default_cost_calculator
        )
        self._hallucination_detector: Callable[[Any, Optional[Any]], bool] = (
            cfg.get("hallucination_detector") or (lambda _o, _e: False)
        )
        self.storage = TraceStorage(self.config["db_path"])
        self._current_run_id: Optional[str] = None

    # ---- Run management ----

    def start_run(self, name: str, metadata: Optional[dict[str, Any]] = None) -> str:
        """Start a new agent run. Returns the run id (UUID)."""
        if metadata is None:
            metadata = {}
        run_id = str(uuid.uuid4())
        self.storage.create_run(
            {
                "id": run_id,
                "name": name,
                "startedAt": int(time.time() * 1000),
                "metadata": metadata,
            }
        )
        self._current_run_id = run_id
        return run_id

    def complete_run(self, status: RunStatus = "success") -> None:
        """Complete the current run."""
        if self._current_run_id:
            self.storage.complete_run(self._current_run_id, status)
            self._current_run_id = None

    # ---- Tracing (core) ----

    def trace(
        self,
        name: str,
        fn: Optional[Callable[[], T]] = None,
        **options: Any,
    ) -> T | _TraceContext:
        """Trace an operation.

        Usage:
            result = agent.trace("my-op", lambda: do_work())

            @agent.trace("my-op")
            def my_work():
                return "hello"

            with agent.trace("my-op") as t:
                val = do_work()
                t.set_output(val)
                # or let it capture if no exception

        Returns the result of fn if fn provided, else a context/decorator object.
        """
        # Normalize option keys (accept camelCase too)
        opts: dict[str, Any] = {}
        for k, v in options.items():
            kl = k.lower().replace("-", "_")
            if kl in ("input", "tokens", "model", "provider", "metadata"):
                opts[kl] = v
            else:
                opts[k] = v

        if fn is not None:
            # Execute immediately (sync), record in finally
            start = int(time.time() * 1000)
            status: Status = "success"
            err: Optional[str] = None
            res: Any = None
            try:
                res = fn()
                return res
            except Exception as e:
                err = str(e)
                status = "error"
                raise
            finally:
                latency_ms = int(time.time() * 1000) - start
                tok_raw = opts.get("tokens") or {}
                if isinstance(tok_raw, TokenUsage):
                    tokens = tok_raw
                else:
                    tokens = TokenUsage(
                        prompt_tokens=tok_raw.get("promptTokens", tok_raw.get("prompt_tokens", 0)),
                        completion_tokens=tok_raw.get("completionTokens", tok_raw.get("completion_tokens", 0)),
                        total_tokens=tok_raw.get("totalTokens", tok_raw.get("total_tokens", 0)),
                        model=tok_raw.get("model") or opts.get("model"),
                        provider=tok_raw.get("provider") or opts.get("provider"),
                    )
                cost_usd = self._cost_calculator(tokens, opts.get("model"))
                trace_id = str(uuid.uuid4())
                run_id = self._current_run_id or str(uuid.uuid4())
                tr = Trace(
                    id=trace_id,
                    run_id=run_id,
                    name=name,
                    status=status,
                    input=opts.get("input"),
                    output=res,
                    tokens=tokens,
                    tool_calls=[],
                    latency_ms=latency_ms,
                    cost_usd=cost_usd,
                    error=err,
                    metadata=opts.get("metadata") or {},
                )
                self.storage.create_trace(tr)
                if self.config.get("auto_cleanup", True):
                    self.storage.cleanup(self.config.get("max_traces", 10000))
            # never reached
            return cast(T, res)  # type: ignore[return-value]

        # No fn: return dual context-manager / decorator object
        return _TraceContext(self, name, opts)

    # ---- Tool calls (stored at trace creation time; this is a stub per TS) ----

    def record_tool_call(self, call: dict[str, Any] | ToolCall) -> str:
        """Record a tool call (note: in current impl, tool calls are passed at trace time)."""
        return str(uuid.uuid4())

    # ---- Query ----

    def get_traces(self, filter: TraceFilter | dict[str, Any] = {}) -> list[Trace]:
        return self.storage.get_traces(filter)

    def get_trace(self, id: str) -> Trace | None:
        return self.storage.get_trace(id)

    def get_runs(self, limit: int = 100) -> list[Run]:
        return self.storage.get_runs(limit)

    def get_run(self, id: str) -> Run | None:
        return self.storage.get_run(id)

    def get_stats(self) -> TraceStats:
        return self.storage.get_stats()

    # ---- Export ----

    def export(self, format: ExportFormat = "json", filter: TraceFilter | dict[str, Any] = {}) -> str:
        traces = self.storage.get_traces(filter)
        if format == "json":
            data: list[dict[str, Any]] = []
            for t in traces:
                data.append(
                    {
                        "id": t.id,
                        "runId": t.run_id,
                        "name": t.name,
                        "status": t.status,
                        "input": t.input,
                        "output": t.output,
                        "tokens": {
                            "promptTokens": t.tokens.prompt_tokens,
                            "completionTokens": t.tokens.completion_tokens,
                            "totalTokens": t.tokens.total_tokens,
                            "model": t.tokens.model,
                            "provider": t.tokens.provider,
                        },
                        "toolCalls": [
                            {
                                "id": tc.id,
                                "name": tc.name,
                                "input": tc.input,
                                "output": tc.output,
                                "latencyMs": tc.latency_ms,
                                "success": tc.success,
                                "error": tc.error,
                                "timestamp": tc.timestamp,
                            }
                            for tc in t.tool_calls
                        ],
                        "latencyMs": t.latency_ms,
                        "costUsd": t.cost_usd,
                        "error": t.error,
                        "metadata": t.metadata,
                        "createdAt": t.created_at,
                        "updatedAt": t.updated_at,
                    }
                )
            return json.dumps(data, indent=2)

        # CSV (mirrors TS)
        headers = [
            "id",
            "runId",
            "name",
            "status",
            "latencyMs",
            "costUsd",
            "totalTokens",
            "createdAt",
        ]
        rows: list[list[Any]] = []
        for t in traces:
            rows.append(
                [
                    t.id,
                    t.run_id,
                    t.name,
                    t.status,
                    t.latency_ms,
                    t.cost_usd,
                    t.tokens.total_tokens,
                    t.created_at,
                ]
            )
        lines = [",".join(str(h) for h in headers)]
        for r in rows:
            lines.append(",".join("" if x is None else str(x) for x in r))
        return "\n".join(lines)

    # ---- Lifecycle ----

    def close(self) -> None:
        """Close the underlying DB connection."""
        self.storage.close()


# ---- Singleton / module level API ----

VERSION = "0.1.0"
PACKAGE_NAME = "agenttrace"

_instance: Optional[AgentTrace] = None


def init(config: TraceConfig | dict[str, Any] | None = None) -> AgentTrace:
    """Initialize (and return) the global AgentTrace instance."""
    global _instance
    _instance = AgentTrace(config)
    return _instance


def get_agent_trace() -> AgentTrace:
    """Get or lazily create the global AgentTrace instance (default config)."""
    global _instance
    if _instance is None:
        _instance = AgentTrace()
    return _instance


def trace(
    name: str,
    fn: Optional[Callable[[], T]] = None,
    **options: Any,
) -> Any:
    """Top-level trace using the global agent instance.

    Supports the same forms as AgentTrace.trace:
      - trace("name", lambda: ...) -> result
      - @trace("name") def fn(): ...
      - with trace("name") as t: ...
    """
    agent = get_agent_trace()
    return agent.trace(name, fn, **options)
