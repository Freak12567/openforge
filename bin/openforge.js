#!/usr/bin/env node

/**
 * openforge CLI
 * 
 * Command-line interface for managing and running AI agents locally.
 * 
 * Usage:
 *   openforge list                         — List installed agents
 *   openforge info <name>                  — Show agent details
 *   openforge create <name> [description]  — Create a new agent from template
 *   openforge run <name> <input>           — Run an agent (requires AI key)
 *   openforge tools                        — List available tools
 *   openforge validate <path>              — Validate an agent manifest
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const AgentManifest = require('../src/AgentManifest');
const AgentLoader = require('../src/AgentLoader');

const AGENT_DIR = path.join(os.homedir(), '.openforge', 'agents');
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

// ── CLI Commands ──

const commands = {
  list() {
    const loader = new AgentLoader({ agentDir: AGENT_DIR });
    loader.discover();
    const agents = loader.list();

    if (agents.length === 0) {
      console.log('\nNo agents installed.');
      console.log(`Agent directory: ${AGENT_DIR}`);
      console.log('\nCreate one with: openforge create <name>\n');
      return;
    }

    console.log(`\n📦 Installed Agents (${agents.length}):\n`);
    for (const agent of agents) {
      const tools = [...agent.tools, ...agent.customTools.map(t => `custom:${t}`)];
      console.log(`  ${agent.ui?.icon || '🤖'} ${agent.name} v${agent.version}`);
      console.log(`     ${agent.description}`);
      if (tools.length > 0) console.log(`     Tools: ${tools.join(', ')}`);
      console.log('');
    }
  },

  info(name) {
    if (!name) {
      console.error('Usage: openforge info <name>');
      process.exit(1);
    }

    const loader = new AgentLoader({ agentDir: AGENT_DIR });
    loader.discover();
    const manifest = loader.get(name);

    if (!manifest) {
      console.error(`Agent "${name}" not found.`);
      process.exit(1);
    }

    const config = manifest.toJSON();
    console.log(`\n${manifest.ui.icon} ${config.name} v${config.version}\n`);
    console.log(`Description: ${config.description}`);
    console.log(`Author: ${config.author || 'unknown'}`);
    console.log(`License: ${config.license || 'MIT'}`);
    console.log(`Model: ${manifest.runtime.model}`);
    console.log(`Max Loops: ${manifest.runtime.maxLoops}`);
    console.log(`Timeout: ${manifest.runtime.timeoutMs}ms`);
    console.log(`\nRequired Tools: ${manifest.requiredTools.join(', ') || 'none'}`);
    console.log(`Optional Tools: ${manifest.optionalTools.join(', ') || 'none'}`);
    console.log(`Custom Tools: ${manifest.customTools.map(t => t.name).join(', ') || 'none'}`);
    console.log(`\nDirectory: ${manifest.basePath}`);
    console.log('');
  },

  create(name, description) {
    if (!name) {
      console.error('Usage: openforge create <name> [description]');
      process.exit(1);
    }

    // Validate name
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && name.length > 1) {
      console.error('Invalid name. Use lowercase alphanumeric with hyphens (e.g., "my-agent").');
      process.exit(1);
    }

    const agentDir = path.join(AGENT_DIR, name);
    if (fs.existsSync(agentDir)) {
      console.error(`Agent "${name}" already exists at ${agentDir}`);
      process.exit(1);
    }

    // Copy basic template
    const templateDir = path.join(TEMPLATES_DIR, 'basic-agent');
    fs.mkdirSync(agentDir, { recursive: true });

    const templateManifest = JSON.parse(fs.readFileSync(path.join(templateDir, '.agent.json'), 'utf8'));
    templateManifest.name = name;
    if (description) templateManifest.description = description;

    fs.mkdirSync(path.join(agentDir, 'tools'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, '.agent.json'), JSON.stringify(templateManifest, null, 2), 'utf8');

    console.log(`\n✅ Agent "${name}" created at ${agentDir}`);
    console.log(`\nEdit: ${path.join(agentDir, '.agent.json')}`);
    console.log(`Run:  openforge run ${name} "hello"`);
    console.log('');
  },

  validate(agentPath) {
    if (!agentPath) {
      console.error('Usage: openforge validate <path-to-agent-dir>');
      process.exit(1);
    }

    const resolved = path.resolve(agentPath);
    try {
      const manifest = AgentManifest.fromDirectory(resolved);
      console.log(`\n✅ Valid agent manifest: ${manifest.name} v${manifest.version}`);
      console.log(`   ${manifest.description}`);
      console.log(`   Tools: ${[...manifest.requiredTools, ...manifest.optionalTools].join(', ') || 'none'}`);
      console.log('');
    } catch (err) {
      console.error(`\n❌ Validation failed:\n   ${err.message}\n`);
      process.exit(1);
    }
  },

  tools() {
    const BuiltinProvider = require('../src/providers/BuiltinProvider');
    const builtin = new BuiltinProvider();
    
    console.log('\n🔧 Built-in Tools:\n');
    for (const tool of builtin._tools) {
      console.log(`  builtin:${tool.name}`);
      console.log(`    ${tool.description}`);
      console.log('');
    }

    console.log('🔌 MCP Tools (configure via agent manifest):\n');
    console.log('  Connect any MCP-compliant server (stdio, SSE, WebSocket)');
    console.log('  See: https://github.com/auxforge/openforge#mcp-support');
    console.log('');
  },

  async run(name, ...inputParts) {
    if (!name) {
      console.error('Usage: openforge run <name> <input>');
      process.exit(1);
    }

    const input = inputParts.join(' ');
    if (!input) {
      console.error('Missing input. Usage: openforge run <name> "your request"');
      process.exit(1);
    }

    console.log(`\n⚡ Running agent "${name}" ...`);
    console.log(`   Input: ${input}\n`);

    // For CLI usage, user needs to set OPENAI_API_KEY or similar
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('Set OPENAI_API_KEY environment variable to run agents from CLI.');
      console.error('Example: OPENAI_API_KEY=sk-xxx openforge run my-agent "hello"');
      process.exit(1);
    }

    try {
      const { AgentBuilder } = require('..');
      
      const builder = new AgentBuilder({
        aiProvider: async (messages, model, tools) => {
          // Use OpenAI SDK directly for CLI usage
          const { OpenAI } = require('openai');
          const client = new OpenAI({ apiKey });
          
          const params = {
            model: model || 'gpt-4o-mini',
            messages,
          };
          if (tools && tools.length > 0) params.tools = tools;
          
          return await client.chat.completions.create(params);
        },
      });

      await builder.initialize();
      const result = await builder.runAgent(name, input);

      if (result.success) {
        console.log('─'.repeat(50));
        console.log(result.output);
        console.log('─'.repeat(50));
        console.log(`\n✅ Completed in ${result.duration}ms (${result.loops} loops, ${result.toolCalls.length} tool calls)\n`);
      } else {
        console.error(`\n❌ Failed: ${result.error}\n`);
      }

      await builder.shutdown();
    } catch (err) {
      console.error(`\n❌ Error: ${err.message}\n`);
      process.exit(1);
    }
  },

  help() {
    console.log(`
openforge — Open-source AI Agent Builder

Commands:
  list                          List installed agents
  info <name>                   Show agent details
  create <name> [description]   Create a new agent from template
  run <name> <input>            Run an agent (needs OPENAI_API_KEY)
  tools                         List available tools
  validate <path>               Validate an agent manifest
  help                          Show this help

Agent Directory: ${AGENT_DIR}
    `);
  },
};

// ── Main ──

const [,, command, ...args] = process.argv;

if (!command || command === 'help' || command === '--help' || command === '-h') {
  commands.help();
} else if (commands[command]) {
  const result = commands[command](...args);
  if (result instanceof Promise) {
    result.catch(err => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
  }
} else {
  console.error(`Unknown command: ${command}`);
  commands.help();
  process.exit(1);
}
