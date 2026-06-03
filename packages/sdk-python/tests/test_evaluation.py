"""
Unit tests for the evaluation framework in Python SDK.
Covers: score() (func + decorator), evaluate() on AgentTrace + top-level,
evaluate_trace(), scores stored in SQLite scores table, get_scores() method.

Mirrors the structure and cases from packages/sdk/src/index.test.ts
"""

import re
import tempfile
from pathlib import Path

import pytest

from agenttrace import (
    AgentTrace,
    init,
    score,
    evaluate,
    evaluate_trace,
    get_agent_trace,
)
from agenttrace.types import Scorer, ScorerResult, TokenUsage, Trace


UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I
)


def make_temp_db() -> str:
    """Use real temp file so WAL etc work."""
    fd, path = tempfile.mkstemp(suffix=".db")
    import os

    os.close(fd)
    return path


def cleanup_db(path: str) -> None:
    p = Path(path)
    for suffix in ("", "-wal", "-shm"):
        try:
            (p.parent / (p.name + suffix)).unlink()
        except FileNotFoundError:
            pass


def test_score_helper_creates_scorer():
    def fn(trace: Trace) -> float:
        return trace.latency_ms / 1000.0

    s = score("my-score", fn)
    assert s.name == "my-score"
    assert callable(s.fn)
    t = Trace(
        id="t1",
        run_id="r1",
        name="n",
        status="success",
        latency_ms=500,
        tokens=TokenUsage(),
    )
    assert s.fn(t) == 0.5


def test_score_as_decorator():
    @score("dec-score")
    def myfn(trace: Trace) -> float:
        return 0.99

    assert isinstance(myfn, Scorer)
    assert myfn.name == "dec-score"
    assert callable(myfn.fn)
    t = Trace(id="t", run_id="r", name="n", status="success")
    assert myfn.fn(t) == 0.99


def test_evaluate_runs_scorers_against_traces_and_stores_scores():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        agent.start_run("eval-run")
        agent.trace("op1", lambda: "hello")
        agent.trace("op2", lambda: "world!!")
        traces = agent.get_traces()
        assert len(traces) == 2

        len_scorer = score("len", lambda t: len(str(t.output or "")))
        results = agent.evaluate(scorers=[len_scorer])

        assert len(results) == 2
        # results order follows traces order (created_at desc, but insertion order here)
        ids = {r.trace_id for r in results}
        assert ids == {traces[0].id, traces[1].id}
        for r in results:
            assert "len" in r.scores
            assert r.errors == {}
            assert isinstance(r.scores["len"], float)

        # verify stored via get_scores (public method)
        stored = agent.get_scores()
        assert len(stored) >= 2
        t0_scores = agent.get_scores(trace_id=traces[0].id)
        assert len(t0_scores) == 1
        assert t0_scores[0]["name"] == "len"
        assert isinstance(t0_scores[0]["value"], (int, float))

        # also via direct storage (internal but for parity with TS integration tests)
        direct = agent.storage.get_scores(traces[0].id)
        assert len(direct) == 1
        assert direct[0]["name"] == "len"

        agent.close()
    finally:
        cleanup_db(db)


def test_evaluate_supports_run_id_and_trace_ids_filters():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        r1 = agent.start_run("r1")
        agent.trace("a", lambda: "A")
        r2 = agent.start_run("r2")
        agent.trace("b", lambda: "BB")
        tr_r1 = agent.get_traces({"run_id": r1})[0]
        tr_r2 = agent.get_traces({"run_id": r2})[0]

        s: Scorer = score("s", lambda t: 1)

        # by run_id (kw style as in tutorial/docs)
        by_run = agent.evaluate(scorers=[s], run_id=r1)
        assert len(by_run) == 1
        assert by_run[0].trace_id == tr_r1.id

        # by trace_ids
        by_ids = agent.evaluate(scorers=[s], trace_ids=[tr_r2.id])
        assert len(by_ids) == 1
        assert by_ids[0].trace_id == tr_r2.id

        # also test positional first-arg list (no scorers= kw)
        by_ids2 = agent.evaluate([s], trace_ids=[tr_r2.id])
        assert len(by_ids2) == 1

        agent.close()
    finally:
        cleanup_db(db)


def test_evaluate_trace_scores_a_single_trace():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        agent.start_run("single-run")
        agent.trace("single-op", lambda: "payload", tokens={"promptTokens": 1, "completionTokens": 1, "totalTokens": 2})
        tr = agent.get_traces()[0]
        assert tr.id

        lat_scorer = score("lat", lambda tr: tr.latency_ms)
        res = agent.evaluate_trace(tr.id, [lat_scorer])

        assert res.trace_id == tr.id
        assert "lat" in res.scores
        assert res.errors == {}
        stored = agent.get_scores(tr.id)
        assert len(stored) == 1
        assert stored[0]["name"] == "lat"
        assert stored[0]["value"] == res.scores["lat"]

        agent.close()
    finally:
        cleanup_db(db)


def test_scorer_errors_are_caught_and_reported_only_valid_stored():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        agent.start_run("err-run")
        agent.trace("err-op", lambda: "x")
        tr = agent.get_traces()[0]

        def bad_fn(trace):
            raise ValueError("scorer boom")

        bad = score("bad", bad_fn)
        ok = score("ok", lambda t: 0.9)

        res = agent.evaluate_trace(tr.id, [bad, ok])

        assert res.scores == {"ok": 0.9}
        assert "bad" in res.errors
        assert res.errors["bad"] == "scorer boom"
        # only ok stored
        stored = agent.get_scores(tr.id)
        assert len(stored) == 1
        assert stored[0]["name"] == "ok"

        agent.close()
    finally:
        cleanup_db(db)


def test_scores_stored_in_sqlite_and_retrievable_via_get_scores():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        agent.start_run("store-run")
        agent.trace("store-op", lambda: "data")
        tr = agent.get_traces()[0]

        sc = score("testsc", lambda t: 0.42)
        res = agent.evaluate_trace(tr.id, [sc])
        assert res.scores["testsc"] == 0.42

        # direct from agent method
        retrieved = agent.get_scores(tr.id)
        assert len(retrieved) == 1
        assert retrieved[0]["name"] == "testsc"
        assert retrieved[0]["value"] == 0.42
        assert retrieved[0]["traceId"] == tr.id
        assert "createdAt" in retrieved[0]

        # all scores
        all_scores = agent.get_scores()
        assert any(s["name"] == "testsc" for s in all_scores)

        agent.close()
    finally:
        cleanup_db(db)


def test_evaluate_respects_concurrency_option_processes_all():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        agent.start_run("conc-run")
        for i in range(5):
            agent.trace(f"c{i}", lambda i=i: f"out{i}")

        s = score("c", lambda tr: len(str(tr.output or "")))
        results = agent.evaluate(scorers=[s], concurrency=2)

        assert len(results) == 5
        for r in results:
            assert "c" in r.scores
            assert r.errors == {}

        # 5 scores stored (no prior)
        stored = agent.get_scores()
        assert len(stored) == 5

        agent.close()
    finally:
        cleanup_db(db)


def test_evaluate_empty_and_edge_cases():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        agent.start_run("edge")
        agent.trace("e1", lambda: "e")

        # empty scorers list
        assert agent.evaluate([]) == []
        res_empty = agent.evaluate_trace(agent.get_traces()[0].id, [])
        assert res_empty.trace_id
        assert res_empty.scores == {}
        assert res_empty.errors == {}

        # missing trace
        miss = agent.evaluate_trace("nonexistent-123", [score("x", lambda t: 1)])
        assert miss.trace_id == "nonexistent-123"
        assert miss.scores == {}
        assert miss.errors == {}

        agent.close()
    finally:
        cleanup_db(db)


def test_top_level_evaluate_evaluate_trace_and_get_scores():
    db = make_temp_db()
    try:
        ag = init({"db_path": db, "silent": True})
        rid = ag.start_run("top-run")
        ag.trace("top1", lambda: "abcdef")

        s = score("l", lambda t: len(str(t.output or "")))
        # top level evaluate (uses global)
        res = evaluate(scorers=[s], run_id=rid)
        assert len(res) == 1
        assert res[0].scores["l"] == 6

        tid = res[0].trace_id
        res2 = evaluate_trace(tid, [s])
        assert res2.scores.get("l") == 6

        # get_scores on the global agent
        gs = get_agent_trace().get_scores(tid)
        assert len(gs) >= 1  # at least from the calls (may be 2 if double)
        assert any(g["name"] == "l" for g in gs)

        ag.close()
    finally:
        cleanup_db(db)


def test_evaluate_accepts_bare_callables_uses_name():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        agent.start_run("bare")
        agent.trace("b1", lambda: "xyz")

        def my_bare(trace):
            return 7.5

        results = agent.evaluate([my_bare])
        assert len(results) == 1
        assert results[0].scores == {"my_bare": 7.5}
        assert results[0].errors == {}

        # lambda gets <lambda> name (current behavior)
        results2 = agent.evaluate([lambda t: 9.0])
        assert "<lambda>" in results2[0].scores or "scorer" in results2[0].scores

        agent.close()
    finally:
        cleanup_db(db)


def test_scorer_invalid_non_number_and_non_finite_rejected():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        agent.start_run("inv")
        agent.trace("i1", lambda: "o")

        def str_ret(t): return "not a num"
        def nan_ret(t): return float("nan")
        def inf_ret(t): return float("inf")
        def ok_ret(t): return 0.123

        res = agent.evaluate([str_ret, nan_ret, inf_ret, ok_ret])
        assert "ok_ret" in res[0].scores
        assert "str_ret" in res[0].errors
        assert "nan_ret" in res[0].errors
        assert "inf_ret" in res[0].errors
        assert "Invalid score returned" in res[0].errors["str_ret"]

        stored = agent.get_scores()
        # only the finite ok one stored
        assert len(stored) == 1
        assert stored[0]["name"] == "ok_ret"

        agent.close()
    finally:
        cleanup_db(db)
