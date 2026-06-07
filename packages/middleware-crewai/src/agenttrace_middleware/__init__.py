"""
AgentTrace CrewAI Middleware
Automatic tracing for CrewAI tasks, tools, and usage.
"""

from .crewai_hook import AgentTraceCrewAI

__all__ = [
    "AgentTraceCrewAI",
]

VERSION = "0.4.3"
PACKAGE_NAME = "agenttrace-io-middleware-crewai"
