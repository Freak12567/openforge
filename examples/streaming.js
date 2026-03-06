/**
 * OpenForge — Event Streaming Example
 * 
 * Shows how to stream agent execution events in real-time.
 * 
 * Run:
 *   OPENAI_API_KEY=sk-xxx node examples/streaming.js
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
  });

  await builder.initialize();

  // Create a test agent
  builder.createAgent({
    name: 'streaming-test',
    description: 'Agent for testing event streaming',
    systemPrompt: 'You are a helpful assistant. Use tools when appropriate.',
    runtime: { model: 'gpt-4o-mini', maxLoops: 5 },
    tools: { require: ['builtin:date_time', 'builtin:http_fetch'] },
  });

  // Run with streaming
  const { runtime, resultPromise } = await builder.runAgentStreaming(
    'streaming-test',
    'What is the current date and time?'
  );

  // Listen to all events
  runtime.on('execution_started', (data) => {
    console.log(`\n🚀 Execution started: ${data.id}`);
  });

  runtime.on('loop_iteration', (data) => {
    console.log(`🔄 Loop ${data.loop}/${data.maxLoops}`);
  });

  runtime.on('tool_call', (data) => {
    console.log(`🔧 Tool call: ${data.tool}(${JSON.stringify(data.args).substring(0, 50)})`);
  });

  runtime.on('tool_result', (data) => {
    const preview = JSON.stringify(data.result).substring(0, 80);
    console.log(`✅ Tool result: ${data.tool} → ${preview}`);
  });

  runtime.on('agent_response', (data) => {
    console.log(`💬 Agent: ${data.content?.substring(0, 100)}`);
  });

  runtime.on('execution_completed', (data) => {
    console.log(`\n🏁 Done in ${data.duration}ms (${data.loops} loops)`);
  });

  // Wait for completion
  const result = await resultPromise;

  console.log('\n─'.repeat(40));
  console.log('Final output:', result.output);
  console.log('─'.repeat(40));

  // Clean up
  builder.deleteAgent('streaming-test');
  await builder.shutdown();
}

main().catch(console.error);
