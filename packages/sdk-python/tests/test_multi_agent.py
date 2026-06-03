"""
Tests for multi-agent tracing: TraceContext, create_child, link_traces, get_trace_tree, parent linking via trace(context=) or parent_id.
"""

import json
import re
import tempfile
import uuid
from pathlib import Path

import pytest

from agenttrace import AgentTrace, init, get_agent_trace, trace, create_child, link_traces, get_trace_tree
from agenttrace.types import TraceContext, TraceTreeNode, TokenUsage


UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I
)


def make_temp_db() -> str:
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


def test_trace_context_dataclass():
    ctx = TraceContext(trace_id="trace-abc", parent_span_id="parent-xyz", metadata={"foo": "bar"})
    assert ctx.trace_id == "trace-abc"
    assert ctx.parent_span_id == "parent-xyz"
    assert ctx.metadata == {"foo": "bar"}

    ctx2 = TraceContext("t1")
    assert ctx2.parent_span_id is None
    assert ctx2.metadata == {}


def test_create_child():
    agent = init({"db_path": make_temp_db(), "silent": True})
    try:
        parent_ctx = TraceContext(trace_id="parent-trace-1", parent_span_id=None, metadata={"level": 0})
        child_ctx = agent.create_child(parent_ctx)
        assert child_ctx.trace_id != parent_ctx.trace_id
        assert UUID_RE.match(child_ctx.trace_id)
        assert child_ctx.parent_span_id == parent_ctx.trace_id
        assert child_ctx.metadata == {"level": 0}

        # also top level
        c2 = create_child(parent_ctx)
        assert c2.parent_span_id == parent_ctx.trace_id
    finally:
        cleanup_db(agent.config["db_path"])
        agent.close()


def test_trace_with_parent_id_stores_parent():
    db = make_temp_db()
    agent = init({"db_path": db, "silent": True})
    try:
        run_id = agent.start_run("parent-run")
        agent.trace(
            "parent-agent",
            lambda: "p",
            tokens={"promptTokens": 1, "completionTokens": 1, "totalTokens": 2},
        )
        parents = agent.get_traces({"run_id": run_id, "name": "parent-agent", "limit": 1})
        parent_tr = parents[0]
        agent.trace(
            "child-agent",
            lambda: "c",
            parent_id=parent_tr.id,
            tokens={"promptTokens": 1, "completionTokens": 1, "totalTokens": 2},
        )
        childs = agent.get_traces({"run_id": run_id, "name": "child-agent", "limit": 1})
        child_tr = childs[0]
        assert child_tr.parent_id == parent_tr.id
        fetched = agent.get_trace(child_tr.id)
        assert fetched is not None
        assert fetched.parent_id == parent_tr.id
    finally:
        cleanup_db(db)
        agent.close()


def test_trace_with_context_links_parent_child_and_tree():
    db = make_temp_db()
    agent = init({"db_path": db, "silent": True})
    try:
        run_id = agent.start_run("ctx-run")
        agent.trace(
            "p-agent",
            lambda: 1,
            tokens={"promptTokens": 0, "completionTokens": 0, "totalTokens": 0},
        )
        p_traces = agent.get_traces({"run_id": run_id, "name": "p-agent", "limit": 1})
        p = p_traces[0]
        p_ctx = TraceContext(trace_id=p.id, parent_span_id=None)
        c_ctx = agent.create_child(p_ctx)
        agent.trace(
            "c-agent",
            lambda: 2,
            context=c_ctx,
            tokens={"promptTokens": 0, "completionTokens": 0, "totalTokens": 0},
        )
        c_traces = agent.get_traces({"run_id": run_id, "name": "c-agent", "limit": 1})
        c = c_traces[0]
        assert c.id == c_ctx.trace_id
        assert c.parent_id == p.id
        tree = agent.get_trace_tree(p.id)
        assert isinstance(tree, TraceTreeNode)
        assert tree.trace.id == p.id
        assert len(tree.children) >= 1
        assert tree.children[0].trace.id == c.id

        # top level get_trace_tree
        t2 = get_trace_tree(p.id)
        assert t2.trace.id == p.id
    finally:
        cleanup_db(db)
        agent.close()


def test_link_traces_and_tree_includes_linked():
    db = make_temp_db()
    agent = init({"db_path": db, "silent": True})
    try:
        run_id = agent.start_run("link-run")
        agent.trace("t1", lambda: "a", tokens={"promptTokens": 0, "completionTokens": 0, "totalTokens": 0})
        agent.trace("t2", lambda: "b", tokens={"promptTokens": 0, "completionTokens": 0, "totalTokens": 0})
        agent.trace("t3", lambda: "c", tokens={"promptTokens": 0, "completionTokens": 0, "totalTokens": 0})
        tr1 = agent.get_traces({"run_id": run_id, "name": "t1", "limit": 1})[0]
        tr2 = agent.get_traces({"run_id": run_id, "name": "t2", "limit": 1})[0]
        tr3 = agent.get_traces({"run_id": run_id, "name": "t3", "limit": 1})[0]
        agent.link_traces([tr1.id, tr2.id, tr3.id])
        tree = agent.get_trace_tree(tr1.id)
        all_ids: list[str] = []

        def collect(node: TraceTreeNode) -> None:
            if node and node.trace:
                all_ids.append(node.trace.id)
            for ch in (node.children or []):
                collect(ch)

        collect(tree)
        assert tr1.id in all_ids
        assert tr2.id in all_ids
        assert tr3.id in all_ids

        # top level link
        link_traces([tr1.id, tr2.id])
    finally:
        cleanup_db(db)
        agent.close()


def test_get_trace_tree_walks_to_root_and_subtree():
    db = make_temp_db()
    agent = init({"db_path": db, "silent": True})
    try:
        run_id = agent.start_run("tree-run")
        agent.trace("root", lambda: 0, tokens={"promptTokens": 0, "completionTokens": 0, "totalTokens": 0})
        roots = agent.get_traces({"run_id": run_id, "name": "root", "limit": 1})
        root = roots[0]
        agent.trace(
            "c1",
            lambda: 1,
            parent_id=root.id,
            tokens={"promptTokens": 0, "completionTokens": 0, "totalTokens": 0},
        )
        c1s = agent.get_traces({"run_id": run_id, "name": "c1", "limit": 1})
        c1 = c1s[0]
        agent.trace(
            "gc",
            lambda: 2,
            parent_id=c1.id,
            tokens={"promptTokens": 0, "completionTokens": 0, "totalTokens": 0},
        )
        gcs = agent.get_traces({"run_id": run_id, "name": "gc", "limit": 1})
        gc = gcs[0]
        tree_from_leaf = agent.get_trace_tree(gc.id)
        assert tree_from_leaf.trace.id == root.id  # walked up
        # find c1 level
        lvl1 = next((n for n in tree_from_leaf.children if n.trace.id == c1.id), None)
        assert lvl1 is not None
        assert len(lvl1.children) == 1
        assert lvl1.children[0].trace.id == gc.id
    finally:
        cleanup_db(db)
        agent.close()


def test_storage_trace_context_methods():
    db = make_temp_db()
    agent = init({"db_path": db, "silent": True})
    try:
        ctx_id = agent.storage.create_trace_context("tr-1", "par-9", {"k": 1})
        assert isinstance(ctx_id, str) and len(ctx_id) > 0
        got = agent.storage.get_trace_context("tr-1")
        assert got is not None
        assert got["traceId"] == "tr-1"
        assert got["parentSpanId"] == "par-9"
        assert got["metadata"] == {"k": 1}
    finally:
        cleanup_db(db)
        agent.close()


def test_trace_context_in_export():
    db = make_temp_db()
    agent = init({"db_path": db, "silent": True})
    try:
        p = agent.trace("p", lambda: "p", tokens=TokenUsage())
        # get the trace id via query since trace returns result not id
        traces = agent.get_traces({"limit": 1})
        p_tr = traces[0]
        c_ctx = agent.create_child(TraceContext(p_tr.id))
        agent.trace("c", lambda: "c", context=c_ctx, tokens=TokenUsage())
        js = agent.export("json")
        data = json.loads(js)
        # find the child
        child = next((d for d in data if d.get("name") == "c"), None)
        assert child is not None
        assert child.get("parentId") == p_tr.id
    finally:
        cleanup_db(db)
        agent.close()
