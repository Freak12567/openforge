# Contributing to OpenForge

First off, thanks for considering contributing! 🎉

## Getting Started

1. **Fork** this repo
2. **Clone** your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/openforge.git
   cd openforge
   npm install
   ```
3. **Create a branch** for your feature/fix:
   ```bash
   git checkout -b feature/my-awesome-feature
   ```

## What Can You Contribute?

### 🔧 New Built-in Tools
Add tools to `src/providers/BuiltinProvider.js`. Each tool needs:
- `name` — lowercase with underscores
- `description` — clear, concise
- `parameters` — OpenAI function schema
- `handler` — async function that returns a result

### 🤖 New Agent Templates
Add a folder to `templates/` with a `.agent.json` manifest:
```
templates/my-template/
  .agent.json        # Agent manifest
  tools/             # Optional custom tool handlers
  README.md          # Template documentation
```

### 🔌 New Providers
Create a provider class in `src/providers/` implementing:
- `discover()` → returns array of tool definitions
- `execute(toolName, args, context)` → returns result

### 🐛 Bug Fixes
Always welcome! Include:
- Steps to reproduce
- Expected vs actual behavior
- Failing test case (if possible)

## Code Style

- **No TypeScript** — plain JavaScript for maximum simplicity
- **CommonJS** (`require/module.exports`) — for Node.js compatibility
- Use `async/await` over callbacks
- Keep functions small and focused
- Add JSDoc comments for public APIs

## Pull Request Process

1. Update tests for your changes
2. Run `npm test` and make sure everything passes
3. Update README.md if you're adding features
4. Create a PR with a clear description of changes
5. Link any related issues

## Commit Messages

Use clear, descriptive commit messages:
```
feat: add web_scrape built-in tool
fix: MCP stdio transport not closing on shutdown
docs: add examples for custom providers
```

## Agent Manifest Schema

When creating templates or modifying agent configs, follow this schema:

```json
{
  "name": "lowercase-with-hyphens",
  "version": "1.0.0",
  "description": "What the agent does",
  "systemPrompt": "Instructions for the AI",
  "runtime": {
    "model": "gpt-4o-mini",
    "maxLoops": 10,
    "timeoutMs": 60000
  },
  "tools": {
    "require": ["builtin:tool_name"],
    "optional": ["mcp:server_tool"]
  }
}
```

## Questions?

Open an issue — we're happy to help! 💬
