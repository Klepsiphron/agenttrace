#!/usr/bin/env python3
"""
hermes-bridge.py -- Bridge Hermes session data into AgentTrace format.

Reads Hermes ~/.hermes/state.db (sessions + messages tables) and populates
an AgentTrace-compatible SQLite DB at ~/.hermes/agenttrace.db.
Zero modifications to Hermes required.

Pure stdlib: sqlite3, json, argparse, pathlib, time, sys, datetime, uuid.

Usage:
    python3 scripts/hermes-bridge.py --full          # Sync all historical data
    python3 scripts/hermes-bridge.py --incremental   # Only new sessions since last sync
    python3 scripts/hermes-bridge.py --watch         # Continuous sync every 30s

After run, the bridged data can be inspected with:
    node packages/cli/dist/index.js --db-path ~/.hermes/agenttrace.db runs
    node packages/cli/dist/index.js --db-path ~/.hermes/agenttrace.db self-stats
"""

import argparse
import json
import sqlite3
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path

HERMES_DB = Path.home() / ".hermes" / "state.db"
AGENTTRACE_DB = Path.home() / ".hermes" / "agenttrace.db"
SYNC_META_TABLE = "_hermes_bridge_meta"


def init_agenttrace_schema(conn: sqlite3.Connection) -> None:
    """Create AgentTrace schema (runs, traces, tool_calls) + sync meta table.
    Uses only f-strings and concatenation for SQL (never .format on SQL).
    """
    # runs table (matches Python SDK storage.py)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS runs ("
        "id TEXT PRIMARY KEY,"
        "name TEXT NOT NULL,"
        "status TEXT NOT NULL DEFAULT 'running',"
        "trace_count INTEGER DEFAULT 0,"
        "total_prompt_tokens INTEGER DEFAULT 0,"
        "total_completion_tokens INTEGER DEFAULT 0,"
        "total_tokens INTEGER DEFAULT 0,"
        "total_tool_calls INTEGER DEFAULT 0,"
        "total_latency_ms INTEGER DEFAULT 0,"
        "total_cost_usd REAL DEFAULT 0,"
        "error_count INTEGER DEFAULT 0,"
        "started_at INTEGER NOT NULL,"
        "completed_at INTEGER,"
        "metadata TEXT DEFAULT '{}',"
        "created_at INTEGER NOT NULL,"
        "updated_at INTEGER NOT NULL"
        ")"
    )

    # traces table (includes parent_id for future parity; tenant_id added by migrations in Task 3)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS traces ("
        "id TEXT PRIMARY KEY,"
        "run_id TEXT NOT NULL,"
        "name TEXT NOT NULL,"
        "status TEXT NOT NULL,"
        "input TEXT,"
        "output TEXT,"
        "prompt_tokens INTEGER DEFAULT 0,"
        "completion_tokens INTEGER DEFAULT 0,"
        "total_tokens INTEGER DEFAULT 0,"
        "model TEXT,"
        "provider TEXT,"
        "latency_ms INTEGER DEFAULT 0,"
        "cost_usd REAL DEFAULT 0,"
        "error TEXT,"
        "metadata TEXT DEFAULT '{}',"
        "parent_id TEXT,"
        "created_at INTEGER NOT NULL,"
        "updated_at INTEGER NOT NULL,"
        "FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE"
        ")"
    )

    # tool_calls table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tool_calls ("
        "id TEXT PRIMARY KEY,"
        "trace_id TEXT NOT NULL,"
        "name TEXT NOT NULL,"
        "input TEXT,"
        "output TEXT,"
        "latency_ms INTEGER DEFAULT 0,"
        "success INTEGER DEFAULT 1,"
        "error TEXT,"
        "timestamp INTEGER NOT NULL,"
        "FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE"
        ")"
    )

    # indexes
    conn.execute("CREATE INDEX IF NOT EXISTS idx_traces_run_id ON traces(run_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_traces_created_at ON traces(created_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tool_calls_trace_id ON tool_calls(trace_id)")

    # Sync metadata table for incremental / last_sync (fixed name, no .format)
    # Use concatenation to define the table name safely in DDL.
    meta_ddl = (
        "CREATE TABLE IF NOT EXISTS " + SYNC_META_TABLE + " ("
        "key TEXT PRIMARY KEY,"
        "value TEXT NOT NULL"
        ")"
    )
    conn.execute(meta_ddl)

    # version table for parity with SDK (simple tracking)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS version ("
        "key TEXT PRIMARY KEY,"
        "value TEXT NOT NULL"
        ")"
    )

    conn.commit()

    # Ensure schema_version row
    row = conn.execute(
        "SELECT value FROM version WHERE key = ?", ("schema_version",)
    ).fetchone()
    if not row:
        conn.execute(
            "INSERT INTO version (key, value) VALUES (?, ?)", ("schema_version", "1")
        )
        conn.commit()


def get_last_sync_ts(conn: sqlite3.Connection) -> float:
    """Return last successful sync timestamp (ms since epoch) or 0."""
    try:
        row = conn.execute(
            f"SELECT value FROM {SYNC_META_TABLE} WHERE key = 'last_sync'"
        ).fetchone()
        return float(row[0]) if row else 0.0
    except Exception:
        return 0.0


def set_last_sync_ts(conn: sqlite3.Connection, ts_ms: int) -> None:
    """Persist last sync timestamp."""
    conn.execute(
        f"INSERT OR REPLACE INTO {SYNC_META_TABLE} (key, value) VALUES (?, ?)",
        ("last_sync", str(ts_ms)),
    )
    conn.commit()


def read_hermes_sessions(hermes_conn: sqlite3.Connection, since_ts: float) -> list[tuple]:
    """Return sessions with started_at > since_ts (Hermes uses unix seconds for started_at)."""
    # Select the columns specified in the production plan
    sql = (
        "SELECT id, title, model, source, started_at, ended_at, "
        "input_tokens, output_tokens, estimated_cost_usd, actual_cost_usd, "
        "tool_call_count, api_call_count, end_reason, "
        "cache_read_tokens, cache_write_tokens, reasoning_tokens, message_count "
        "FROM sessions "
        "WHERE started_at > ? "
        "ORDER BY started_at ASC"
    )
    cur = hermes_conn.execute(sql, (since_ts,))
    return cur.fetchall()


def read_tool_call_messages(hermes_conn: sqlite3.Connection, session_id: str) -> list[tuple]:
    """Return messages that contain non-empty tool_calls JSON for this session."""
    sql = (
        "SELECT id, tool_calls, tool_name, content, token_count, timestamp, finish_reason "
        "FROM messages "
        "WHERE session_id = ? AND tool_calls IS NOT NULL AND tool_calls != '' "
        "ORDER BY timestamp ASC"
    )
    cur = hermes_conn.execute(sql, (session_id,))
    return cur.fetchall()


def compute_total_tokens(session_row: tuple) -> int:
    """Sum input + output + cache + reasoning tokens."""
    # Unpack relevant positions from SELECT order above
    (
        _sid, _title, _model, _source, _started, _ended,
        input_tokens, output_tokens, _est, _act,
        _tcc, _acc, _end_reason,
        cache_read, cache_write, reasoning, _msg_count
    ) = session_row
    return (
        int(input_tokens or 0)
        + int(output_tokens or 0)
        + int(cache_read or 0)
        + int(cache_write or 0)
        + int(reasoning or 0)
    )


def choose_cost(session_row: tuple) -> float:
    """Prefer actual_cost_usd, fall back to estimated_cost_usd, else 0."""
    (
        _sid, _title, _model, _source, _started, _ended,
        _it, _ot, est_cost, act_cost,
        _tcc, _acc, _end_reason,
        _cr, _cw, _rt, _mc
    ) = session_row
    if act_cost is not None:
        try:
            return float(act_cost)
        except Exception:
            pass
    if est_cost is not None:
        try:
            return float(est_cost)
        except Exception:
            pass
    return 0.0


def import_hermes_session(
    at_conn: sqlite3.Connection,
    session_row: tuple,
    tool_messages: list[tuple],
) -> bool:
    """Import one Hermes session as one run + N traces (one per tool_call message).
    Returns True on success.
    """
    (
        sid, title, model, source, started_at, ended_at,
        input_tokens, output_tokens, _est, _act,
        tool_call_count, api_call_count, end_reason,
        _cr, _cw, _rt, _mc
    ) = session_row

    now_ms = int(time.time() * 1000)
    started_ms = int(started_at * 1000) if started_at else now_ms
    completed_ms = int(ended_at * 1000) if ended_at else None

    cost = choose_cost(session_row)
    total_tokens = compute_total_tokens(session_row)

    run_name = title or ("hermes-" + str(sid)[:8])
    status = "success" if (end_reason or "").lower() not in ("error", "failure") else "error"

    metadata = json.dumps({
        "source": source or "hermes",
        "model": model,
        "api_call_count": int(api_call_count or 0),
        "end_reason": end_reason or "",
        "hermes_session_id": sid,
        "imported_by": "hermes-bridge",
    })

    try:
        # Create the run (idempotency is enforced by caller checking existence)
        at_conn.execute(
            "INSERT OR REPLACE INTO runs "
            "(id, name, status, trace_count, total_prompt_tokens, total_completion_tokens, "
            "total_tokens, total_tool_calls, total_cost_usd, started_at, completed_at, "
            "metadata, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                sid,
                run_name,
                status,
                len(tool_messages),
                int(input_tokens or 0),
                int(output_tokens or 0),
                total_tokens,
                int(tool_call_count or len(tool_messages)),
                cost,
                started_ms,
                completed_ms,
                metadata,
                now_ms,
                now_ms,
            ),
        )

        # One trace per tool_calls message (as per spec)
        for msg in tool_messages:
            (
                msg_id,
                tool_calls_json,
                tool_name,
                content,
                token_count,
                ts,
                finish_reason,
            ) = msg

            trace_id = str(uuid.uuid4())
            ts_ms = int(ts * 1000) if ts else started_ms

            # Parse tool_calls to extract a compact input representation
            tool_input = None
            try:
                if tool_calls_json:
                    calls = json.loads(tool_calls_json)
                    if isinstance(calls, list) and calls:
                        first = calls[0]
                        if isinstance(first, dict):
                            # common shapes: {function: {arguments: ...}} or {input: ...}
                            fn = first.get("function") or {}
                            args = fn.get("arguments") if isinstance(fn, dict) else None
                            if args is None:
                                args = first.get("input")
                            tool_input = json.dumps(args)[:2000] if args is not None else None
            except Exception:
                tool_input = None

            tool_output = None
            if content is not None:
                try:
                    tool_output = (content if isinstance(content, str) else json.dumps(content))[:2000]
                except Exception:
                    tool_output = str(content)[:2000]

            trace_name = "tool:" + (tool_name or "unknown")
            trace_status = "success" if (finish_reason or "").lower() not in ("tool_error", "error") else "error"

            # Rough token split for the trace (best effort; run aggregates the real numbers)
            tc = int(token_count or 0)
            p_tok = tc // 2
            c_tok = tc - p_tok

            at_conn.execute(
                "INSERT OR REPLACE INTO traces "
                "(id, run_id, name, status, input, output, prompt_tokens, completion_tokens, "
                "total_tokens, model, latency_ms, cost_usd, metadata, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    trace_id,
                    sid,
                    trace_name,
                    trace_status,
                    tool_input,
                    tool_output,
                    p_tok,
                    c_tok,
                    tc,
                    model,
                    0,
                    0.0,
                    json.dumps({"hermes_message_id": msg_id}),
                    ts_ms,
                    ts_ms,
                ),
            )

        at_conn.commit()
        return True

    except Exception as e:
        try:
            at_conn.rollback()
        except Exception:
            pass
        print(f"  ERROR importing session {str(sid)[:8]}: {e}", file=sys.stderr)
        return False


def run_bridge(incremental: bool = False) -> None:
    """Core sync logic. Safe to call repeatedly."""
    if not HERMES_DB.exists():
        print(f"Hermes DB not found at {HERMES_DB}", file=sys.stderr)
        sys.exit(1)

    hermes_conn = sqlite3.connect(str(HERMES_DB))
    hermes_conn.row_factory = sqlite3.Row

    at_conn = sqlite3.connect(str(AGENTTRACE_DB))
    at_conn.row_factory = sqlite3.Row
    init_agenttrace_schema(at_conn)

    # Determine window
    since = 0.0
    if incremental:
        last = get_last_sync_ts(at_conn)
        if last > 0:
            # Hermes started_at is unix seconds (float)
            since = last / 1000.0
            try:
                print(f"Incremental sync: sessions after {datetime.fromtimestamp(since).isoformat()}")
            except Exception:
                print(f"Incremental sync: sessions after ts={since}")

    sessions = read_hermes_sessions(hermes_conn, since)
    print(f"Found {len(sessions)} sessions to consider")

    imported = 0
    skipped = 0
    total_tool_calls_imported = 0
    total_cost_imported = 0.0

    for session in sessions:
        sid = session[0]

        # Idempotency: if run with this id exists, skip entire session
        existing = at_conn.execute("SELECT id FROM runs WHERE id = ?", (sid,)).fetchone()
        if existing:
            skipped += 1
            continue

        tool_msgs = read_tool_call_messages(hermes_conn, sid)
        ok = import_hermes_session(at_conn, session, tool_msgs)
        if ok:
            imported += 1
            n_tools = len(tool_msgs)
            total_tool_calls_imported += n_tools
            c = choose_cost(session)
            total_cost_imported += c
            title = session[1] or str(sid)[:8]
            print(f"  Imported: {title} | {n_tools} tool traces | ${c:.4f}")

    # Update watermark
    set_last_sync_ts(at_conn, int(time.time() * 1000))

    # Final summary numbers from target DB
    total_runs = at_conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
    total_traces = at_conn.execute("SELECT COUNT(*) FROM traces").fetchone()[0]
    total_cost = at_conn.execute("SELECT COALESCE(SUM(total_cost_usd), 0) FROM runs").fetchone()[0] or 0.0
    total_tokens = at_conn.execute("SELECT COALESCE(SUM(total_tokens), 0) FROM runs").fetchone()[0] or 0

    print("")
    print("=== Bridge Summary ===")
    print(f"Imported: {imported} new sessions")
    print(f"Skipped:  {skipped} already imported")
    print(f"Total:    {total_runs} sessions, {total_traces} tool call traces")
    print(f"Tokens:   {total_tokens:,}")
    print(f"Cost:     ${total_cost:.4f}")
    print(f"DB:       {AGENTTRACE_DB}")

    hermes_conn.close()
    at_conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Bridge Hermes session data into AgentTrace DB")
    parser.add_argument("--full", action="store_true", help="Sync all historical data (default)")
    parser.add_argument("--incremental", action="store_true", help="Only sessions since last sync marker")
    parser.add_argument("--watch", action="store_true", help="Continuous sync every 30 seconds")
    args = parser.parse_args()

    if not any([args.full, args.incremental, args.watch]):
        args.full = True

    if args.watch:
        print("Watch mode: syncing every 30s (Ctrl+C to stop)")
        try:
            while True:
                run_bridge(incremental=True)
                print("\nNext sync in 30s...")
                time.sleep(30)
        except KeyboardInterrupt:
            print("\nWatch stopped.")
    elif args.incremental:
        run_bridge(incremental=True)
    else:
        run_bridge(incremental=False)


if __name__ == "__main__":
    main()
