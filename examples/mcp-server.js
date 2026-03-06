/**
 * OpenForge — MCP Server Example
 * 
 * Shows how to connect MCP servers and use their tools.
 * 
 * Run:
 *   OPENAI_API_KEY=sk-xxx node examples/mcp-server.js
 */

const { AgentBuilder } = require('../');

async function main() {
  const builder = new AgentBuilder({
    aiProvider: async (messages, model, tools) => {
      const { OpenAI } = require('openai');
      const client = new OpenAI();
      return await client.chat.completions.create({
        model: model || 'gpt-4o-mini',
        messages,
        tools: tools?.length > 0 ? tools : undefined,
      });
    },
    // You can pass MCP servers at init time
    mcpServers: {
      // Example: filesystem MCP server
      // 'filesystem': {
      //   transport: 'stdio',
      //   command: 'npx',
      //   args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      // },
    },
  });

  await builder.initialize();

  // Or add MCP servers dynamically
  // await builder.addMcpServer('calculator', {
  //   transport: 'stdio',
  //   command: 'npx',
  //   args: ['-y', '@example/mcp-calculator'],
  // });

  // List all tools (including MCP ones)
  const tools = builder.listTools();
  console.log(`\n🔧 Available tools (${tools.length}):\n`);
  for (const tool of tools) {
    console.log(`  ${tool.name} — ${tool.description}`);
  }

  // List connected MCP servers
  const servers = builder.listMcpServers();
  console.log(`\n🔌 MCP Servers: ${servers.length === 0 ? 'none' : ''}`);
  for (const server of servers) {
    console.log(`  ${server.name} (${server.status})`);
  }

  await builder.shutdown();
}

main().catch(console.error);
