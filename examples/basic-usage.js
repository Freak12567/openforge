/**
 * OpenForge — Basic Usage Example
 * 
 * Shows how to use OpenForge programmatically with OpenAI.
 * 
 * Run:
 *   OPENAI_API_KEY=sk-xxx node examples/basic-usage.js
 */

const { AgentBuilder } = require('../');

async function main() {
  // 1. Create a builder with your AI provider
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
  });

  // 2. Initialize (discovers agents + tools)
  await builder.initialize();

  // 3. Create an agent programmatically
  const agent = builder.createAgent({
    name: 'example-agent',
    description: 'A simple example agent',
    systemPrompt: 'You are a helpful assistant. Be concise.',
    runtime: { model: 'gpt-4o-mini', maxLoops: 3 },
    tools: { require: ['builtin:date_time'] },
  });

  console.log(`Created: ${agent.name}`);

  // 4. Run it
  const result = await builder.runAgent('example-agent', 'What time is it?');
  
  if (result.success) {
    console.log('\n✅ Output:', result.output);
    console.log(`   Duration: ${result.duration}ms, Loops: ${result.loops}`);
  } else {
    console.error('❌ Error:', result.error);
  }

  // 5. Clean up
  builder.deleteAgent('example-agent');
  await builder.shutdown();
}

main().catch(console.error);
