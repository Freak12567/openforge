/**
 * AgentRuntime — Execute an agent with a tool-calling loop
 * 
 * This is the core execution engine. It:
 * 1. Loads agent manifest
 * 2. Resolves required tools from the ToolRegistry
 * 3. Builds system prompt + tool schemas
 * 4. Runs the AI tool-calling loop until completion
 * 
 * Decoupled from any database or framework — uses simple callbacks for AI.
 */

const EventEmitter = require('events');

// Execution states
const AgentState = {
  IDLE: 'idle',
  RUNNING: 'running',
  COMPLETED: 'completed',
  ERROR: 'error',
  CANCELLED: 'cancelled',
};

class AgentRuntime extends EventEmitter {
  /**
   * @param {Object} options
   * @param {ToolRegistry} options.toolRegistry — Shared tool registry
   * @param {Function} options.aiProvider — async (messages, model, tools) => response
   *   Must return OpenAI-compatible response: { choices: [{ message: { content, tool_calls? } }] }
   */
  constructor({ toolRegistry, aiProvider }) {
    super();
    this.toolRegistry = toolRegistry;
    this.aiProvider = aiProvider;
    
    /** @type {Map<string, AgentExecution>} */
    this.executions = new Map();
  }

  /**
   * Run an agent with the given input
   * @param {AgentManifest} manifest — Parsed agent manifest
   * @param {string} userInput — User's message/instruction
   * @param {Object} context — Execution context { sessionId, userId, ... }
   * @returns {Promise<AgentResult>}
   */
  async run(manifest, userInput, context = {}) {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    const execution = {
      id: executionId,
      agentName: manifest.name,
      state: AgentState.RUNNING,
      startTime: Date.now(),
      loopCount: 0,
      toolCalls: [],
      messages: [],
      output: '',
    };
    this.executions.set(executionId, execution);
    this.emit('execution_started', { id: executionId, agent: manifest.name });

    try {
      // 1. Check tool requirements
      const { satisfied, missing } = this.toolRegistry.checkRequirements(manifest.requiredTools);
      if (!satisfied) {
        throw new Error(`Missing required tools: ${missing.join(', ')}`);
      }

      // 2. Resolve all tools and build schemas
      const allToolRefs = [...manifest.requiredTools, ...manifest.optionalTools];
      const toolSchemas = this.toolRegistry.getSchemasForRefs(allToolRefs);
      
      // Also add custom tool schemas
      for (const customTool of manifest.customTools) {
        toolSchemas.push({
          type: 'function',
          function: {
            name: customTool.name,
            description: customTool.description || `Custom tool: ${customTool.name}`,
            parameters: customTool.parameters || { type: 'object', properties: {} },
          },
        });
      }

      // 3. Build conversation
      const conversation = [
        { role: 'system', content: manifest.systemPrompt },
        { role: 'user', content: userInput },
      ];
      execution.messages = [...conversation];

      // 4. Tool-calling loop
      const runtime = manifest.runtime;
      let isComplete = false;
      let consecutiveErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 3;

      while (!isComplete && execution.loopCount < runtime.maxLoops) {
        execution.loopCount++;

        // Check cancellation
        if (execution.state === AgentState.CANCELLED) {
          this.emit('execution_cancelled', { id: executionId });
          break;
        }

        this.emit('loop_iteration', { 
          id: executionId, 
          loop: execution.loopCount,
          maxLoops: runtime.maxLoops 
        });

        // Call AI provider
        const aiResponse = await this.aiProvider(
          conversation,
          runtime.model,
          toolSchemas.length > 0 ? toolSchemas : undefined,
          { agentName: manifest.name, executionId, ...context }
        );

        const message = aiResponse.choices?.[0]?.message;
        if (!message) {
          throw new Error('AI provider returned empty response');
        }

        // Add assistant message to conversation
        conversation.push({
          role: 'assistant',
          content: message.content || '',
          tool_calls: message.tool_calls || undefined,
        });

        // Handle tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls) {
            const fnName = toolCall.function?.name;
            const fnArgs = JSON.parse(toolCall.function?.arguments || '{}');

            this.emit('tool_call', { 
              id: executionId, 
              tool: fnName, 
              args: fnArgs 
            });

            // Execute the tool
            let toolResult;
            try {
              toolResult = await this.toolRegistry.execute(fnName, fnArgs, {
                ...context,
                agentName: manifest.name,
                executionId,
              });
              consecutiveErrors = 0;
            } catch (toolErr) {
              consecutiveErrors++;
              toolResult = JSON.stringify({
                success: false,
                error: toolErr.message,
              });

              if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                toolResult = JSON.stringify({
                  success: false,
                  error: toolErr.message,
                  system_hint: `[STOP] ${consecutiveErrors} consecutive tool errors. Tell the user what failed and ask for guidance.`,
                });
              }
            }

            execution.toolCalls.push({
              tool: fnName,
              args: fnArgs,
              result: toolResult,
              timestamp: Date.now(),
            });

            // Add tool result to conversation
            conversation.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
            });

            this.emit('tool_result', { 
              id: executionId, 
              tool: fnName, 
              result: toolResult 
            });
          }
        } else {
          // No tool calls — AI responded with final text
          isComplete = true;
          execution.output = message.content || '';

          this.emit('agent_response', { 
            id: executionId, 
            content: execution.output 
          });
        }
      }

      // Finalize
      execution.state = isComplete ? AgentState.COMPLETED : AgentState.ERROR;
      if (!isComplete && execution.loopCount >= runtime.maxLoops) {
        execution.output = `Agent reached maximum loop limit (${runtime.maxLoops}). Last response may be incomplete.`;
        execution.state = AgentState.COMPLETED;
      }

      execution.endTime = Date.now();
      execution.duration = execution.endTime - execution.startTime;

      this.emit('execution_completed', {
        id: executionId,
        agent: manifest.name,
        state: execution.state,
        duration: execution.duration,
        loops: execution.loopCount,
        toolCalls: execution.toolCalls.length,
      });

      return {
        success: execution.state === AgentState.COMPLETED,
        executionId,
        output: execution.output,
        toolCalls: execution.toolCalls,
        loops: execution.loopCount,
        duration: execution.duration,
      };

    } catch (err) {
      execution.state = AgentState.ERROR;
      execution.error = err.message;
      execution.endTime = Date.now();

      this.emit('execution_error', {
        id: executionId,
        agent: manifest.name,
        error: err.message,
      });

      return {
        success: false,
        executionId,
        error: err.message,
        toolCalls: execution.toolCalls,
        loops: execution.loopCount,
        duration: Date.now() - execution.startTime,
      };
    }
  }

  /**
   * Cancel a running execution
   * @param {string} executionId 
   */
  cancel(executionId) {
    const execution = this.executions.get(executionId);
    if (execution && execution.state === AgentState.RUNNING) {
      execution.state = AgentState.CANCELLED;
      this.emit('execution_cancelled', { id: executionId });
      return true;
    }
    return false;
  }

  /**
   * Get execution status
   * @param {string} executionId 
   */
  getStatus(executionId) {
    const execution = this.executions.get(executionId);
    if (!execution) return null;
    return {
      id: execution.id,
      agent: execution.agentName,
      state: execution.state,
      loops: execution.loopCount,
      toolCalls: execution.toolCalls.length,
      duration: execution.endTime 
        ? execution.endTime - execution.startTime 
        : Date.now() - execution.startTime,
      output: execution.output,
      error: execution.error,
    };
  }
}

module.exports = { AgentRuntime, AgentState };
