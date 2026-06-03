# AgentTrace Orchestration System
# CEO: OWL (Hermes Agent)
# 
# Operating Principles (from 2026 research):
# 1. CAID: Centralized Asynchronous Isolated Delegation
# 2. Isolation: Workers never share state, separate contexts
# 3. Async: Never block on delegates, continue working
# 4. Batched delegation: 8-10 parallel Grok sessions max (rate limit)
# 5. Dependency graph: Track what depends on what
# 6. Verification: Always verify delegated output before integration

## Rate Limits (Hard Constraints)
- Grok CLI: 15M tokens/min team rate limit → max 8-10 parallel sessions
- delegate_task: ~8min timeout per subagent → keep tasks small
- OpenRouter Owl-Alpha: free tier, be efficient

## Delegation Decision Matrix
| Task Type | Method | Why |
|-----------|--------|-----|
| Multi-file feature impl | Grok CLI (background) | Complex, needs full context |
| Writing tests for existing code | Grok CLI (background) | Pattern-matching heavy |
| Research (web/x) | Self (web_search/x_search) | Fast, cheap, needs synthesis |
| Code review | delegate_task (small) | Focused, <5 min |
| File writes/edits | Self (execute_code) | Near-zero token cost |
| Planning/specs | Self (write_file) | Needs my judgment |
| Verification | Self (terminal/read_file) | Must trust but verify |
| Git operations | Self (terminal) | Fast, needs care |

## Batch Management
- Wave size: 8-10 Grok sessions max
- Launch wave → immediately continue working
- Check results only when all in wave complete
- Failed tasks go to next wave or self-do queue

## Project State Tracking
See PROJECT_BOARD.md for task-level tracking.
This file is the ORCHESTRATION protocol.
