/**
 * OpenForge — Open-source AI Agent Builder
 * 
 * Create, share, and run AI agents with MCP, relay, and custom tool support.
 * 
 * Usage:
 * 
 *   const { AgentBuilder } = require('openforge');
 *   
 *   const builder = new AgentBuilder({
 *     aiProvider: async (messages, model, tools) => { ... },
 *   });
 *   
 *   await builder.initialize();
 *   
 *   // Add MCP server
 *   await builder.addMcpServer('calendar', {
 *     transport: 'stdio',
 *     command: 'npx',
 *     args: ['-y', '@anthropic/mcp-google-calendar'],
 *   });
 *   
 *   // Run an agent
 *   const result = await builder.runAgent('my-agent', 'check my calendar');
 */

const AgentManifest = require('./src/AgentManifest');
const { AgentRuntime, AgentState } = require('./src/AgentRuntime');
const AgentLoader = require('./src/AgentLoader');
const ToolRegistry = require('./src/ToolRegistry');

// Providers
const { McpProvider } = require('./src/providers/McpProvider');
const RelayProvider = require('./src/providers/RelayProvider');
const BuiltinProvider = require('./src/providers/BuiltinProvider');
const CustomProvider = require('./src/providers/CustomProvider');

class AgentBuilder {
  /**
   * @param {Object} options
   * @param {Function} options.aiProvider — async (messages, model, tools, meta) => OpenAI-format response
   * @param {Object} [options.relayManager] — Optional relay manager instance (for relay tools)
   * @param {string} [options.agentDir] — Custom agent directory (default: ~/.openforge/agents/)
   * @param {string[]} [options.additionalAgentDirs] — Additional directories to scan for agents
   * @param {Object} [options.mcpServers] — MCP server configs keyed by name
   */
  constructor(options = {}) {
    if (!options.aiProvider) {
      throw new Error('AgentBuilder requires an aiProvider function');
    }

    this.aiProvider = options.aiProvider;
    this.toolRegistry = new ToolRegistry();
    this.loader = new AgentLoader({
      agentDir: options.agentDir,
      additionalDirs: options.additionalAgentDirs,
    });
    this.runtime = new AgentRuntime({
      toolRegistry: this.toolRegistry,
      aiProvider: this.aiProvider,
    });

    // Providers
    this.builtinProvider = new BuiltinProvider();
    this.mcpProvider = new McpProvider();
    this.customProvider = new CustomProvider();
    this.relayProvider = options.relayManager
      ? new RelayProvider({ relayManager: options.relayManager })
      : null;

    this.mcpServerConfigs = options.mcpServers || {};
    this._initialized = false;
  }

  /**
   * Initialize the builder: register providers, discover agents and tools
   */
  async initialize() {
    console.log('[OpenForge] Initializing...');

    // 1. Register tool providers
    this.toolRegistry.registerProvider('builtin', this.builtinProvider);
    this.toolRegistry.registerProvider('mcp', this.mcpProvider);
    this.toolRegistry.registerProvider('custom', this.customProvider);
    
    if (this.relayProvider) {
      this.toolRegistry.registerProvider('relay', this.relayProvider);
    }

    // 2. Connect MCP servers
    for (const [name, config] of Object.entries(this.mcpServerConfigs)) {
      try {
        await this.mcpProvider.addServer(name, config);
      } catch (err) {
        console.error(`[OpenForge] Failed to connect MCP server "${name}":`, err.message);
      }
    }

    // 3. Discover all tools
    await this.toolRegistry.discoverAll();

    // 4. Discover agents
    this.loader.discover();

    this._initialized = true;
    console.log(`[OpenForge] Ready. ${this.loader.agents.size} agents, ${this.toolRegistry.tools.size} tools available.`);
  }

  // ════════════════════════════════════════════════════════
  // Agent Operations
  // ════════════════════════════════════════════════════════

  /**
   * Run an agent by name
   * @param {string} agentName 
   * @param {string} userInput 
   * @param {Object} context — { sessionId, userId, ... }
   * @returns {Promise<AgentResult>}
   */
  async runAgent(agentName, userInput, context = {}) {
    this._ensureInitialized();

    const manifest = this.loader.get(agentName);
    if (!manifest) {
      return { success: false, error: `Agent "${agentName}" not found. Available: ${[...this.loader.agents.keys()].join(', ')}` };
    }

    // Load custom tools for this agent
    if (manifest.customTools.length > 0) {
      this.customProvider.loadFromManifest(manifest);
      await this.toolRegistry.discoverAll();
    }

    return await this.runtime.run(manifest, userInput, context);
  }

  /**
   * Run an agent and return the runtime for event streaming
   * @param {string} agentName 
   * @param {string} userInput 
   * @param {Object} context
   * @returns {{ runtime: AgentRuntime, resultPromise: Promise<AgentResult> }}
   */
  async runAgentStreaming(agentName, userInput, context = {}) {
    this._ensureInitialized();

    const manifest = this.loader.get(agentName);
    if (!manifest) {
      throw new Error(`Agent "${agentName}" not found`);
    }

    if (manifest.customTools.length > 0) {
      this.customProvider.loadFromManifest(manifest);
      await this.toolRegistry.discoverAll();
    }

    const resultPromise = this.runtime.run(manifest, userInput, context);
    return { runtime: this.runtime, resultPromise };
  }

  /**
   * List all available agents
   * @param {Object} filter
   */
  listAgents(filter = {}) {
    this._ensureInitialized();
    return this.loader.list(filter);
  }

  /**
   * Create a new agent
   * @param {Object} config — Agent manifest config
   * @returns {AgentManifest}
   */
  createAgent(config) {
    this._ensureInitialized();
    return this.loader.create(config);
  }

  /**
   * Delete an agent
   * @param {string} name 
   */
  deleteAgent(name) {
    this._ensureInitialized();
    return this.loader.delete(name);
  }

  /**
   * Update an agent
   * @param {string} name 
   * @param {Object} updates 
   */
  updateAgent(name, updates) {
    this._ensureInitialized();
    return this.loader.update(name, updates);
  }

  /**
   * Get an agent's manifest
   * @param {string} name 
   */
  getAgent(name) {
    this._ensureInitialized();
    const manifest = this.loader.get(name);
    return manifest ? manifest.toJSON() : null;
  }

  /**
   * Install an agent from a remote source
   * @param {string} source — URL or registry name
   */
  async installAgent(source) {
    this._ensureInitialized();
    return await this.loader.install(source);
  }

  // ════════════════════════════════════════════════════════
  // MCP Management
  // ════════════════════════════════════════════════════════

  /**
   * Add an MCP server
   * @param {string} name — Server identifier
   * @param {Object} config — { transport, command?, args?, url?, env? }
   */
  async addMcpServer(name, config) {
    await this.mcpProvider.addServer(name, config);
    await this.toolRegistry.discoverAll();
    return this.mcpProvider.listServers().find(s => s.name === name);
  }

  /**
   * Remove an MCP server
   * @param {string} name 
   */
  async removeMcpServer(name) {
    await this.mcpProvider.removeServer(name);
    await this.toolRegistry.discoverAll();
  }

  /**
   * List connected MCP servers
   */
  listMcpServers() {
    return this.mcpProvider.listServers();
  }

  // ════════════════════════════════════════════════════════
  // Tool Operations
  // ════════════════════════════════════════════════════════

  /**
   * List all available tools across all providers
   */
  listTools() {
    this._ensureInitialized();
    return this.toolRegistry.listTools();
  }

  /**
   * Execute a tool directly (for testing)
   * @param {string} toolName 
   * @param {Object} args 
   * @param {Object} context 
   */
  async executeTool(toolName, args, context = {}) {
    this._ensureInitialized();
    return await this.toolRegistry.execute(toolName, args, context);
  }

  // ════════════════════════════════════════════════════════
  // Lifecycle
  // ════════════════════════════════════════════════════════

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('[OpenForge] Shutting down...');
    await this.mcpProvider.disconnectAll();
    this.customProvider.clear();
    this._initialized = false;
  }

  /** @private */
  _ensureInitialized() {
    if (!this._initialized) {
      throw new Error('AgentBuilder not initialized. Call await builder.initialize() first.');
    }
  }
}

module.exports = {
  AgentBuilder,
  AgentManifest,
  AgentRuntime,
  AgentState,
  AgentLoader,
  ToolRegistry,
  // Providers
  McpProvider,
  RelayProvider,
  BuiltinProvider,
  CustomProvider,
};
