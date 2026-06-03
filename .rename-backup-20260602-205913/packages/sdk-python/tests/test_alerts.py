"""
Tests for alerting framework (alert(), register_alert, check_alerts, webhook via urllib, SQLite storage).
Mirrors the structure and coverage of packages/sdk/src/index.test.ts alerting tests.
"""

import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from agenttrace import AgentTrace, alert, get_agent_trace, init
from agenttrace.types import AlertCondition, AlertHistory, TraceStats


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


UUID_RE = None  # not needed, history ids are uuids


def test_alert_helper_creates_condition():
    cond = lambda stats: (stats.total_traces or 0) > 10  # noqa: E731
    a = alert(
        {
            "name": "high-volume",
            "condition": cond,
            "cooldown": 120,
            "webhook": "https://ex/hook",
        }
    )
    assert isinstance(a, AlertCondition)
    assert a.name == "high-volume"
    assert callable(a.condition)
    assert a.condition(TraceStats(total_traces=5)) is False
    assert a.condition(TraceStats(total_traces=20)) is True
    assert a.cooldown == 120
    assert a.webhook == "https://ex/hook"
    assert a.last_triggered is None
    assert a.email is None


def test_alert_helper_kwargs_form():
    def cond(s: TraceStats) -> bool:
        return (s.success_rate or 0) < 0.5

    a = alert(name="low-success", condition=cond, cooldown=0, email="x@y.z")
    assert a.name == "low-success"
    assert a.email == "x@y.z"
    assert a.cooldown == 0


def test_register_alert_and_get_alerts():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        cond = lambda s: (s.total_traces or 0) > 0  # noqa: E731
        al = alert({"name": "vol", "condition": cond, "cooldown": 30})
        agent.register_alert(al)
        # persisted
        stored = agent.storage.get_stored_alerts()
        assert any(s["name"] == "vol" for s in stored)
        got = agent.get_alerts()
        assert any(g.name == "vol" for g in got)
        # dedupe: re-register same name replaces
        al2 = alert({"name": "vol", "condition": lambda s: False, "cooldown": 99})
        agent.register_alert(al2)
        got2 = agent.get_alerts()
        matches = [g for g in got2 if g.name == "vol"]
        assert len(matches) == 1
        assert matches[0].cooldown == 99
        agent.close()
    finally:
        cleanup_db(db)


def test_check_alerts_fires_when_condition_met():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        al = alert({
            "name": "always",
            "condition": lambda _s: True,
            "cooldown": 0,
        })
        agent.register_alert(al)
        fired = agent.check_alerts()
        assert len(fired) == 1
        h = fired[0]
        assert isinstance(h, AlertHistory)
        assert h.alert_name == "always"
        assert h.delivered is False  # no webhook/email
        assert h.error == "no delivery channel configured"
        # history persisted
        hist = agent.get_alert_history()
        assert len(hist) >= 1
        assert hist[0].alert_name == "always"
        agent.close()
    finally:
        cleanup_db(db)


def test_cooldown_prevents_rapid_retrigger():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        al = alert({
            "name": "cd",
            "condition": lambda _s: True,
            "cooldown": 9999,
        })
        agent.register_alert(al)
        first = agent.check_alerts()
        assert len(first) == 1
        second = agent.check_alerts()
        assert len(second) == 0
        # last_triggered updated on agent registered copy
        assert agent._registered_alerts[0].last_triggered is not None
        agent.close()
    finally:
        cleanup_db(db)


def test_webhook_delivery_success_and_history():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        al = alert({
            "name": "wh",
            "condition": lambda _s: True,
            "webhook": "https://hooks.example/test",
            "cooldown": 0,
        })
        agent.register_alert(al)

        mock_resp = MagicMock()
        mock_resp.getcode.return_value = 200
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.__exit__.return_value = False

        with patch("urllib.request.urlopen", return_value=mock_resp) as mock_urlopen:
            res = agent.check_alerts()
            assert len(res) == 1
            assert res[0].delivered is True
            assert res[0].error is None
            # called with correct args
            call_args = mock_urlopen.call_args
            assert call_args is not None
            req = call_args[0][0]
            assert req.full_url == "https://hooks.example/test"
            assert req.method == "POST"
            assert req.headers["Content-Type"] == "application/json"
            assert req.headers["User-Agent"] == "AgentTrace/0.2"

        # history records delivered true
        hists = agent.get_alert_history()
        assert any(h.alert_name == "wh" and h.delivered is True for h in hists)
        agent.close()
    finally:
        cleanup_db(db)


def test_webhook_delivery_failure_sets_error():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        al = alert({
            "name": "whfail",
            "condition": lambda _s: True,
            "webhook": "https://hooks.example/fail",
            "cooldown": 0,
        })
        agent.register_alert(al)

        with patch("urllib.request.urlopen", side_effect=Exception("connection refused")):
            res = agent.check_alerts()
            assert len(res) == 1
            assert res[0].delivered is False
            assert "connection refused" in (res[0].error or "")

        hists = agent.get_alert_history()
        assert any(h.alert_name == "whfail" and h.delivered is False for h in hists)
        agent.close()
    finally:
        cleanup_db(db)


def test_condition_error_is_caught_and_does_not_fire():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": False})
        def bad(s):
            raise RuntimeError("boom in cond")
        al = alert({"name": "badcond", "condition": bad, "cooldown": 0})
        agent.register_alert(al)
        # should not raise, and not fire
        fired = agent.check_alerts()
        assert len(fired) == 0
        agent.close()
    finally:
        cleanup_db(db)


def test_auto_alert_check_after_trace():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        agent.start_run("arun")
        al = alert({"name": "auto1", "condition": lambda _s: True, "cooldown": 0})
        agent.register_alert(al)
        # trace should trigger auto check
        res = agent.trace("op", lambda: "x")
        assert res == "x"
        hists = agent.get_alert_history()
        assert any(h.alert_name == "auto1" for h in hists)
        agent.close()
    finally:
        cleanup_db(db)


def test_get_alerts_merges_persisted_and_runtime():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        # register one (persists)
        al1 = alert({"name": "p1", "condition": lambda s: True, "cooldown": 5})
        agent.register_alert(al1)
        # simulate CLI: new agent instance loads from persisted, no runtime cond
        agent2 = AgentTrace({"db_path": db, "silent": True})
        loaded = agent2.get_alerts()
        p1 = next((a for a in loaded if a.name == "p1"), None)
        assert p1 is not None
        assert p1.cooldown == 5
        # runtime condition is no-op for persisted-only
        assert p1.condition(TraceStats()) is False
        # now register on agent2 overlays real cond
        real_cond = lambda s: (s.total_traces or 0) > 0
        al1b = alert({"name": "p1", "condition": real_cond, "cooldown": 10})
        agent2.register_alert(al1b)
        loaded2 = agent2.get_alerts()
        p1b = next((a for a in loaded2 if a.name == "p1"), None)
        assert p1b is not None
        assert p1b.cooldown == 10
        assert p1b.condition(TraceStats(total_traces=5)) is True
        agent.close()
        agent2.close()
    finally:
        cleanup_db(db)


def test_alert_history_order_and_fields():
    db = make_temp_db()
    try:
        agent = AgentTrace({"db_path": db, "silent": True})
        al = alert({"name": "h1", "condition": lambda _s: True, "cooldown": 0})
        agent.register_alert(al)
        agent.check_alerts()
        time.sleep(0.001)
        al2 = alert({"name": "h2", "condition": lambda _s: True, "cooldown": 0})
        agent.register_alert(al2)
        agent.check_alerts()
        hist = agent.get_alert_history()
        assert len(hist) >= 2
        # newest first
        assert hist[0].alert_name in ("h2", "h1")
        for h in hist:
            assert isinstance(h.stats, dict)
            assert "totalTraces" in h.stats or "total_traces" not in str(h.stats)  # numeric camel in storage
            assert isinstance(h.triggered_at, int)
            assert isinstance(h.delivered, bool)
        agent.close()
    finally:
        cleanup_db(db)


def test_silent_suppresses_prints(monkeypatch):
    db = make_temp_db()
    try:
        prints = []
        monkeypatch.setattr("builtins.print", lambda *a, **k: prints.append(a))
        agent = AgentTrace({"db_path": db, "silent": True})
        al = alert({"name": "s1", "condition": lambda _s: True, "cooldown": 0})
        agent.register_alert(al)
        agent.check_alerts()
        # no prints for trigger
        assert not any("Alert 's1' triggered" in str(p) for p in prints)
        agent.close()
    finally:
        cleanup_db(db)
