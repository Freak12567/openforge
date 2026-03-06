<p align="center">
  <h1 align="center">🔥 OpenForge</h1>
  <p align="center">
    <strong>Open-source AI Agent Builder</strong><br>
    Create, share, and run AI agents with MCP, tool-calling, and any AI provider.
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/openforge"><img src="https://img.shields.io/npm/v/openforge?color=purple&label=npm" alt="npm version"></a>
    <a href="https://github.com/auxforge/openforge/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
    <a href="https://github.com/auxforge/openforge"><img src="https://img.shields.io/github/stars/auxforge/openforge?style=social" alt="GitHub Stars"></a>
    <img src="https://img.shields.io/badge/node-%3E%3D18-green" alt="Node.js">
  </p>
</p>

---

Build AI agents that **use tools**, **connect to MCP servers**, and **work with any AI provider** (OpenAI, Anthropic, Gemini, Groq, local models). Each agent is a portable JSON manifest that anyone can share, install, and run.

## ✨ Features

- 🔌 **Full MCP Support** — stdio, SSE, and WebSocket transports
- 🔧 **Built-in Tools** — HTTP fetch, JSON parse, text transform, date/time
- 🎨 **Custom Tools** — Write JS handlers, sandboxed via VM
- 🤖 **Any AI Provider** — Bring your own: OpenAI, Anthropic, Gemini, Ollama, anything
- 📦 **Portable Agents** — JSON manifests that anyone can share and install
- ⚡ **Event Streaming** — Real-time execution tracking via EventEmitter
- 🖥️ **CLI Included** — Create, run, and manage agents from the terminal

## 🚀 Quick Start

```bash
# Install globally
npm install -g openforge

# Create your first agent
openforge create my-agent "A helpful assistant"

# Run it (needs an API key)
OPENAI_API_KEY=sk-xxx openforge run my-agent "What's the weather in NYC?"
```

## 📦 Programmatic Usage

```javascript
const { AgentBuilder } = require('openforge');

const builder = new AgentBuilder({
  aiProvider: async (messages, model, tools) => {
    // Use any AI provider — OpenAI, Anthropic, Gemini, etc.
    const { OpenAI } = require('openai');
    const client = new OpenAI();
    return await client.chat.completions.create({
      model: model || 'gpt-4o-mini',
      messages,
      tools: tools?.length > 0 ? tools : undefined,
    });
  },
});

await builder.initialize();

// Run an agent
const result = await builder.runAgent('my-agent', 'Hello!');
console.log(result.output);

// Stream execution events
const { runtime, resultPromise } = await builder.runAgentStreaming('my-agent', 'Hello!');
runtime.on('tool_call', (data) => console.log(`🔧 ${data.tool}`));
runtime.on('agent_response', (data) => console.log(`💬 ${data.content}`));
const finalResult = await resultPromise;

await builder.shutdown();
```

## 🏗️ Architecture

```
┌──────────────────────────────────────────┐
│              OpenForge                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ Runtime   │ │ Registry │ │  Loader  │ │
│  │(executor) │ │ (tools)  │ │ (agents) │ │
│  └─────┬─────┘ └─────┬────┘ └────┬─────┘ │
│        │              │           │        │
│  ┌─────┴──────────────┴───────────┤       │
│  │         Tool Registry          │       │
│  ├────────┬────────┬──────────────┤       │
│  │  MCP   │Built-in│   Custom     │       │
│  │ Client │ Tools  │  JS/VM       │       │
│  └──┬─────┘────────┘──────────────┘       │
└─────┼─────────────────────────────────────┘
      │
  MCP Servers (any!)
  - stdio (spawn local process)
  - SSE (HTTP streaming)
  - WebSocket (persistent)
```

## 📋 Agent Manifest

Every agent is defined by a `.agent.json` file:

```json
{
  "name": "my-agent",
  "version": "1.0.0",
  "description": "What this agent does",
  "systemPrompt": "You are a helpful assistant...",
  "runtime": {
    "model": "gpt-4o-mini",
    "maxLoops": 10,
    "timeoutMs": 60000
  },
  "tools": {
    "require": ["builtin:http_fetch", "builtin:json_parse"],
    "optional": ["mcp:calendar"]
  },
  "ui": {
    "icon": "🤖"
  }
}
```

## 🔌 MCP Support

Full [Model Context Protocol](https://modelcontextprotocol.io/) support — connect to any MCP server:

```javascript
// stdio — spawn a local MCP server
await builder.addMcpServer('calculator', {
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@example/mcp-calculator'],
});

// SSE — connect to an HTTP MCP server
await builder.addMcpServer('api', {
  transport: 'sse',
  url: 'http://localhost:3001/sse',
});

// WebSocket — persistent connection
await builder.addMcpServer('realtime', {
  transport: 'websocket',
  url: 'ws://localhost:8080',
});
```

## 🔧 Tool Providers

| Provider | Prefix | Description |
|----------|--------|-------------|
| **Built-in** | `builtin:` | `http_fetch`, `json_parse`, `text_transform`, `date_time`, `wait` |
| **MCP** | `mcp:` | Any MCP-compliant server (stdio, SSE, WebSocket) |
| **Custom** | `custom:` | Agent-local JS handlers (sandboxed via VM) |

## 🎨 Creating Custom Tools

Define custom tools in your agent manifest:

```json
{
  "tools": {
    "custom": [
      {
        "name": "analyze_data",
        "description": "Analyze data from a CSV",
        "parameters": {
          "type": "object",
          "properties": {
            "data": { "type": "string" }
          }
        },
        "handler": "./tools/analyzeData.js"
      }
    ]
  }
}
```

Handler file (`tools/analyzeData.js`):

```javascript
module.exports = async function(args, context) {
  const { data } = args;
  // Your analysis logic here
  return { success: true, result: 'Analysis complete' };
};
```

## 🖥️ CLI Reference

```bash
openforge list                          # List installed agents
openforge info <name>                   # Show agent details
openforge create <name> [description]   # Create from template
openforge run <name> <input>            # Run (needs OPENAI_API_KEY)
openforge tools                         # List available tools
openforge validate <path>               # Validate manifest
```

## ⚡ Event Streaming

The runtime emits events during execution for real-time tracking:

```javascript
const { runtime, resultPromise } = await builder.runAgentStreaming('my-agent', input);

runtime.on('execution_started', (data) => { /* { id, agent } */ });
runtime.on('loop_iteration', (data) => { /* { id, loop, maxLoops } */ });
runtime.on('tool_call', (data) => { /* { id, tool, args } */ });
runtime.on('tool_result', (data) => { /* { id, tool, result } */ });
runtime.on('agent_response', (data) => { /* { id, content } */ });
runtime.on('execution_completed', (data) => { /* { id, agent, duration, loops } */ });

const result = await resultPromise;
```

## 📖 API Reference

### `new AgentBuilder(options)`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `aiProvider` | `Function` | ✅ | `async (messages, model, tools, meta) => OpenAI-format response` |
| `agentDir` | `string` | | Custom agent directory (default: `~/.openforge/agents/`) |
| `mcpServers` | `Object` | | Initial MCP server configs |
| `additionalAgentDirs` | `string[]` | | Extra directories to scan for agents |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `initialize()` | `Promise` | Must be called before any operations |
| `runAgent(name, input, ctx)` | `Promise<Result>` | Run an agent synchronously |
| `runAgentStreaming(name, input, ctx)` | `{ runtime, resultPromise }` | Run with event streaming |
| `createAgent(config)` | `AgentManifest` | Create a new agent |
| `deleteAgent(name)` | `boolean` | Delete an agent |
| `listAgents(filter)` | `Agent[]` | List all agents |
| `addMcpServer(name, config)` | `Promise<Server>` | Connect MCP server |
| `removeMcpServer(name)` | `Promise` | Disconnect MCP server |
| `listTools()` | `Tool[]` | List all available tools |
| `shutdown()` | `Promise` | Graceful shutdown |

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

[MIT](LICENSE) — build whatever you want.
