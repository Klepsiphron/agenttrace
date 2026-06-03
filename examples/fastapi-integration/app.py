"""
AgentTrace + FastAPI Integration Example

Demonstrates how to integrate AgentTrace tracing into a FastAPI application.
Each endpoint is automatically traced with input/output, latency, and optional
token/cost tracking for LLM-powered routes.

Run (from this directory, after editable install of the sdk):
    pip install -e ../../packages/sdk-python
    pip install fastapi uvicorn
    uvicorn app:app --reload --port 8000

Or with PUBLIC install:
    pip install agenttrace-io fastapi uvicorn
    uvicorn app:app --reload --port 8000

Then open:
    http://localhost:8000/docs     -- Swagger UI
    http://localhost:8000/stats    -- trace statistics
    http://localhost:8000/runs     -- recent runs
"""

import hashlib
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from agenttrace import AgentTrace, init, get_agent_trace, AgentUsageTracker
from agenttrace import TokenUsage, TraceConfig


# ---------------------------------------------------------------------------
# AgentTrace initialisation
# ---------------------------------------------------------------------------

# Option A: use the module-level singleton (init once, use everywhere)
agent = init({
    "db_path": "./agenttrace.db",
    "max_traces": 50000,
    "auto_cleanup": True,
})

# Option B (alternative): create your own instance and pass it around
# agent = AgentTrace({"db_path": "./agenttrace.db"})

# Thin usage tracker for self-observing agent actions
tracker = AgentUsageTracker(
    agent_name="fastapi-agent",
    agent_type="api-server",
    db_path="./agenttrace.db",
)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    message: str
    model: Optional[str] = "gpt-4o-mini"
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    trace_id: str
    run_id: str
    response: str
    tokens: dict
    cost_usd: float
    latency_ms: int


class SearchRequest(BaseModel):
    query: str
    max_results: Optional[int] = 5


class SearchResponse(BaseModel):
    trace_id: str
    results: list[dict[str, Any]]
    count: int


class ErrorResponse(BaseModel):
    detail: str
    trace_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def fake_llm_call(message: str, model: str = "gpt-4o-mini") -> dict[str, Any]:
    """Simulate an LLM call. Replace with your real provider."""
    time.sleep(0.05)  # simulate network latency
    return {
        "text": f"Echo from {model}: {message[::-1]}",
        "prompt_tokens": len(message.split()) * 2 + 10,
        "completion_tokens": len(message.split()) * 2,
        "model": model,
    }


def fake_search(query: str, max_results: int = 5) -> list[dict[str, Any]]:
    """Simulate a search tool. Replace with your real search backend."""
    time.sleep(0.02)
    return [
        {"title": f"Result {i+1} for '{query[:30]}'", "url": f"https://example.com/{i+1}"}
        for i in range(min(max_results, 3))
    ]


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create a run for the server session
    run_id = agent.start_run("fastapi-server", {"type": "http-server"})
    tracker.start_session()
    yield
    # Shutdown
    agent.complete_run("success")
    tracker.end_session()
    agent.close()


app = FastAPI(
    title="AgentTrace + FastAPI Example",
    description="Demonstrates AgentTrace tracing in FastAPI endpoints",
    version="0.1.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    """Health check."""
    return {"status": "ok", "service": "agenttrace-fastapi-example"}


@app.post("/chat", response_model=ChatResponse, responses={500: {"model": ErrorResponse}})
async def chat(req: ChatRequest):
    """
    Chat endpoint traced with AgentTrace.

    Every call creates a trace record with:
    - input (the user message)
    - model name and token usage
    - computed cost
    - latency
    """
    run_id = agent.start_run("chat-session", {"endpoint": "/chat"})

    try:
        # --- traced LLM call ---
        t_start = int(time.time() * 1000)

        def do_chat():
            result = fake_llm_call(req.message, req.model)
            return result

        llm_result = agent.trace(
            "llm-call",
            do_chat,
            input={"message": req.message, "model": req.model},
            model=req.model,
            tokens={
                "prompt_tokens": 0,  # placeholder; updated below
                "completion_tokens": 0,
                "total_tokens": 0,
            },
        )

        # Re-record with actual token counts from the LLM response
        # (in production your real LLM client would return these)
        tokens = TokenUsage(
            prompt_tokens=llm_result["prompt_tokens"],
            completion_tokens=llm_result["completion_tokens"],
            total_tokens=llm_result["prompt_tokens"] + llm_result["completion_tokens"],
            model=llm_result["model"],
        )

        # --- traced response generation ---
        response_text = agent.trace(
            "generate-response",
            lambda: llm_result["text"],
            input={"raw": llm_result["text"]},
            tokens=tokens,
            model=llm_result["model"],
        )

        # Track agent-level action
        tracker.track_action("chat", req.message[:50], {"model": req.model})

        agent.complete_run("success")

        # Build cost from the trace we created
        latency_ms = int(time.time() * 1000) - t_start

        # Compute cost using the SDK's built-in calculator
        cost_usd = agent._cost_calculator(tokens, req.model)

        trace_id = str(uuid.uuid4())

        # Create one combined trace for the whole request
        final_trace = agent.trace(
            "chat-request",
            lambda: response_text,
            input={"message": req.message},
            output=response_text,
            tokens=tokens,
            model=req.model,
        )

        # The SDK already stored the trace -- query it back
        # Actually, trace() with fn returns the result and stores internally.
        # We stored 3 traces above. Let's just return stats from the latest run.

        return ChatResponse(
            trace_id=final_trace or "see-runs-endpoint",
            run_id=run_id,
            response=response_text,
            tokens={
                "prompt_tokens": tokens.prompt_tokens,
                "completion_tokens": tokens.completion_tokens,
                "total_tokens": tokens.total_tokens,
                "model": tokens.model,
            },
            cost_usd=round(cost_usd, 6),
            latency_ms=latency_ms,
        )

    except Exception as e:
        agent.complete_run("error")
        track_id = str(uuid.uuid4())
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search", response_model=SearchResponse)
async def search(req: SearchRequest):
    """
    Search endpoint showing tool-call style tracing.

    Demonstrates `with agent.trace(...)` context manager usage,
    which is ideal for multi-step tool invocations.
    """
    result = agent.trace(
        "search-tool",
        lambda: fake_search(req.query, req.max_results),
        input={"query": req.query, "max_results": req.max_results},
    )

    tracker.track_action("search", req.query[:50])

    # Context-manager style example for post-processing step
    with agent.trace("format-results") as ctx:
        formatted = [{"rank": i + 1, **r} for i, r in enumerate(result)]
        ctx.set_output(formatted)

    return SearchResponse(
        trace_id=str(uuid.uuid4()),
        results=formatted,
        count=len(formatted),
    )


@app.get("/stats")
async def stats():
    """Return aggregate trace statistics from the DB."""
    s = agent.get_stats()
    return {
        "total_runs": s.total_runs,
        "total_traces": s.total_traces,
        "success_rate": round(s.success_rate, 4),
        "avg_latency_ms": round(s.avg_latency_ms, 2),
        "total_cost_usd": round(s.total_cost_usd, 6),
        "total_tokens": s.total_tokens,
        "avg_tokens_per_trace": round(s.avg_tokens_per_trace, 1),
        "top_tools": s.top_tools[:5],
        "top_errors": s.top_errors[:5],
    }


@app.get("/runs")
async def runs(limit: int = 20):
    """List recent agent runs."""
    runs_list = agent.get_runs(limit=limit)
    return {
        "runs": [
            {
                "id": r.id,
                "name": r.name,
                "status": r.status,
                "trace_count": r.trace_count,
                "total_tokens": r.total_tokens.total_tokens if r.total_tokens else 0,
                "total_latency_ms": r.total_latency_ms,
                "total_cost_usd": round(r.total_cost_usd, 6),
                "started_at": r.started_at,
                "completed_at": r.completed_at,
                "metadata": r.metadata,
            }
            for r in runs_list
        ]
    }


@app.get("/traces")
async def traces(run_id: Optional[str] = None, limit: int = 50):
    """List traces, optionally filtered by run_id."""
    filter_opts: dict[str, Any] = {"limit": limit}
    if run_id:
        filter_opts["run_id"] = run_id
    traces_list = agent.get_traces(filter_opts)
    return {
        "traces": [
            {
                "id": t.id,
                "run_id": t.run_id,
                "name": t.name,
                "status": t.status,
                "latency_ms": t.latency_ms,
                "cost_usd": round(t.cost_usd, 6),
                "total_tokens": t.tokens.total_tokens,
                "model": t.tokens.model,
                "error": t.error,
                "created_at": t.created_at,
            }
            for t in traces_list
        ]
    }


@app.get("/usage")
async def usage():
    """Return agent usage stats from the usage tracker table."""
    stats = tracker.get_session_stats()
    agent_stats = tracker.storage.get_usage_stats(agent_name="fastapi-agent")
    return {
        "session": stats,
        "overall": {
            "total_agents": agent_stats.total_agents,
            "total_actions": agent_stats.total_actions,
            "total_tokens": agent_stats.total_tokens,
            "total_cost_usd": round(agent_stats.total_cost_usd, 6),
            "avg_duration_ms": round(agent_stats.avg_duration_ms, 2),
            "actions_by_type": agent_stats.actions_by_type,
            "top_agents": agent_stats.top_agents[:5],
        },
    }


@app.post("/evaluate")
async def evaluate_traces(run_id: Optional[str] = None):
    """
    Run built-in scorers against stored traces and return scores.

    Demonstrates the evaluate() API for quality assessment.
    """
    from agenttrace import Scorer

    scorers = [
        Scorer(name="output-length", fn=lambda t: len(str(t.output or ""))),
        Scorer(name="is-success", fn=lambda t: 1.0 if t.status == "success" else 0.0),
        Scorer(name="low-latency", fn=lambda t: 1.0 if t.latency_ms < 200 else 0.0),
    ]

    results = agent.evaluate(scorers, run_id=run_id)
    return {
        "results": [
            {
                "trace_id": r.trace_id,
                "scores": {k: round(v, 4) for k, v in r.scores.items()},
                "errors": r.errors,
            }
            for r in results
        ]
    }


# ---------------------------------------------------------------------------
# Entrypoint (for `python app.py`)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
