# AgentTrace -- Quick Reference

## Run These Commands on Your PC

### View your agent sessions
```bash
cd /home/ryano/projects/agenttrace
AGENTTRACE_DB_PATH=~/.hermes/agenttrace.db node packages/cli/dist/index.js runs
```

### See token/cost stats
```bash
AGENTTRACE_DB_PATH=~/.hermes/agenttrace.db node packages/cli/dist/index.js stats
```

### Trace any command (zero-config)
```bash
node packages/cli/dist/index.js wrap echo "hello"
node packages/cli/dist/index.js wrap python my_script.py
```

### Set a budget alert
```bash
node packages/cli/dist/index.js budget set my-agent --tokens 1000000 --cost 50
node packages/cli/dist/index.js budget status my-agent
node packages/cli/dist/index.js budget list
```

### Launch the web dashboard
```bash
AGENTTRACE_DB_PATH=~/.hermes/agenttrace.db node packages/cli/dist/index.js dashboard
# Opens at http://127.0.0.1:4317
```

### Python SDK quick test
```python
from agenttrace import AgentTrace
agent = AgentTrace(dbPath='./test.db')
run_id = agent.start_run('my-session')
result = agent.trace('my-tool', lambda: 'hello')
print(f"Run: {run_id}, Result: {result}")
agent.complete_run()
agent.close()
```

### Run tests
```bash
pnpm test
```

### Build from source
```bash
pnpm build
```
