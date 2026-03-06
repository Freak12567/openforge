# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2024-03-06

### Added
- 🏗️ Core: `AgentBuilder`, `AgentRuntime`, `AgentManifest`, `AgentLoader`
- 🔧 Built-in tools: `http_fetch`, `json_parse`, `text_transform`, `date_time`, `wait`
- 🔌 MCP support: stdio, SSE, and WebSocket transports
- 📡 Relay provider: optional bridge for desktop integrations
- 🎨 Custom provider: agent-local JS tool handlers (sandboxed via VM)
- 📦 CLI: `openforge list|info|create|run|tools|validate`
- 📋 Templates: `basic-agent`, `mcp-agent`, `whatsapp-assistant`
- ⚡ Event streaming: `runAgentStreaming()` for real-time execution tracking
