# AgentTrace vs Langfuse vs LangSmith

## Honest comparison

| Feature                  |            AgentTrace            |              Langfuse              |              LangSmith              |
| ------------------------ | :------------------------------: | :--------------------------------: | :---------------------------------: |
| **Cost (local)**         |           Free forever           | Free (self-host, needs Docker/K8s) |          N/A (cloud only)           |
| **Cost (cloud)**         |               N/A                |   Free 50K units/mo, then $29/mo   | Free 5K traces/mo, then $39/seat/mo |
| **Open source**          |               MIT                |          MIT (self-host)           |            Closed source            |
| **Self-host**            |     SQLite file, zero config     |        Docker/K8s required         |            Not available            |
| **Setup**                |    npm install / pip install     |           Docker compose           |      Sign up at langchain.com       |
| **Data leaves machine**  |              Never               |        Only if using cloud         |               Always                |
| **CLI**                  |        Full CLI included         |            Web UI only             |             Web UI only             |
| **Python SDK**           |               Yes                |                Yes                 |                 Yes                 |
| **TypeScript SDK**       |               Yes                |                Yes                 |                 Yes                 |
| **Framework lock-in**    |    None (framework-agnostic)     |   None (but LangChain preferred)   |           LangGraph only            |
| **Evaluations**          |             Not yet              |              Built-in              |              Built-in               |
| **Prompt management**    |                No                |                Yes                 |                 Yes                 |
| **Real-time monitoring** |         Local dashboard          |          Cloud dashboard           |           Cloud dashboard           |
| **Team features**        |             Not yet              |             Yes (paid)             |             Yes (paid)              |
| **GitHub stars**         |           New project            |                28K+                |                 N/A                 |
| **Best for**             | Privacy, simplicity, local-first |  Full-featured OSS observability   |      LangGraph production apps      |

## When to choose AgentTrace

Choose AgentTrace when:

- You need observability without sending data to the cloud
- You want zero-config setup (no Docker, no accounts, no signups)
- You value privacy (prompts never leave your machine)
- You work in the terminal and want CLI-first tooling
- You're building agents in any framework (not just LangChain)
- You want a local SQLite file you can query with SQL
- You want OpenTelemetry export for integration with existing tools

Choose Langfuse when:

- You need a full-featured LLM engineering platform
- You want built-in evaluations, prompt management, and experiments
- You're okay with Docker/K8s for self-hosting
- Your team needs shared dashboards and collaboration

Choose LangSmith when:

- You're building on LangGraph/LangChain
- You want the most mature, production-tested platform
- You don't mind cloud-only and usage-based pricing
- You need enterprise features like SOC2 compliance

## Honest limitations of AgentTrace

- No evaluation framework yet (coming in v0.3.0)
- No prompt management
- No team/collaboration features
- No cloud hosted version (local only)
- New project, smaller community
- Fewer integrations than established tools

We built AgentTrace because we needed something simple, local, and
private. If that's what you need too, try it out.
