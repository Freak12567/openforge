/**
 * ToolRegistry — Unified tool provider interface
 * 
 * All tools (MCP, relay, built-in, custom) register here.
 * Provides discovery, schema generation, and execution routing.
 * 
 * Tool references use prefixed format:
 *   relay:whatsapp        → relay WhatsApp tools
 *   relay:file            → relay file ops
 *   mcp:calendar:create   → MCP server tool
 *   builtin:http_fetch    → Built-in HTTP tool
 *   (no prefix)           → Custom agent-local tool
 */

const EventEmitter = require('events');

class ToolRegistry extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, ToolProvider>} */
    this.providers = new Map();
    /** @type {Map<string, ResolvedTool>} resolved tool name → tool object */
    this.tools = new Map();
    /** @type {Map<string, string>} tool name → provider key */
    this.toolProviderMap = new Map();
  }

  /**
   * Register a tool provider
   * @param {string} prefix — Provider prefix (e.g., 'relay', 'mcp', 'builtin')
   * @param {Object} provider — Provider instance implementing { name, discover(), execute() }
   */
  registerProvider(prefix, provider) {
    if (this.providers.has(prefix)) {
      console.warn(`[ToolRegistry] Overwriting provider for prefix: ${prefix}`);
    }
    this.providers.set(prefix, provider);
    console.log(`[ToolRegistry] Registered provider: ${prefix} (${provider.name || 'unnamed'})`);
    this.emit('provider_registered', { prefix, name: provider.name });
  }

  /**
   * Discover all available tools from all registered providers
   * @returns {Promise<Map<string, ResolvedTool>>}
   */
  async discoverAll() {
    this.tools.clear();
    this.toolProviderMap.clear();

    for (const [prefix, provider] of this.providers) {
      try {
        const tools = await provider.discover();
        for (const tool of tools) {
          const qualifiedName = `${prefix}:${tool.name}`;
          this.tools.set(qualifiedName, tool);
          this.toolProviderMap.set(qualifiedName, prefix);
        }
        console.log(`[ToolRegistry] Discovered ${tools.length} tools from ${prefix}`);
      } catch (err) {
        console.error(`[ToolRegistry] Failed to discover tools from ${prefix}:`, err.message);
      }
    }

    this.emit('tools_discovered', { count: this.tools.size });
    return this.tools;
  }

  /**
   * Resolve a tool reference from an agent manifest
   * Handles prefixed (relay:whatsapp) and unprefixed (custom) references
   * @param {string} ref — Tool reference string
   * @returns {ResolvedTool|null}
   */
  resolve(ref) {
    // Direct match (fully qualified)
    if (this.tools.has(ref)) {
      return this.tools.get(ref);
    }

    // Try with prefix iterations
    for (const [prefix] of this.providers) {
      const qualified = `${prefix}:${ref}`;
      if (this.tools.has(qualified)) {
        return this.tools.get(qualified);
      }
    }

    return null;
  }

  /**
   * Register a single custom tool directly (for agent-local tools)
   * @param {Object} tool — { name, description, schema, execute }
   */
  registerCustomTool(tool) {
    if (!tool.name || !tool.execute) {
      throw new Error(`Custom tool must have 'name' and 'execute' function`);
    }
    const qualifiedName = `custom:${tool.name}`;
    this.tools.set(qualifiedName, tool);
    this.toolProviderMap.set(qualifiedName, 'custom');
    console.log(`[ToolRegistry] Registered custom tool: ${qualifiedName}`);
  }

  /**
   * Execute a tool by its qualified name
   * @param {string} toolName — Qualified tool name (e.g., "relay:whatsapp")
   * @param {Object} args — Tool arguments
   * @param {Object} context — Execution context { sessionId, agentName, ... }
   * @returns {Promise<string>} — Tool result as string
   */
  async execute(toolName, args, context = {}) {
    const tool = this.resolve(toolName);
    if (!tool) {
      return JSON.stringify({
        success: false,
        error: `Tool "${toolName}" not found. Available: ${[...this.tools.keys()].join(', ')}`,
      });
    }

    const providerPrefix = this.toolProviderMap.get(toolName) || 
                           this.toolProviderMap.get(`custom:${toolName}`);
    const provider = providerPrefix ? this.providers.get(providerPrefix) : null;

    try {
      const startTime = Date.now();
      let result;

      // Route through provider if it has an execute method, otherwise use tool's own
      if (provider && typeof provider.execute === 'function') {
        result = await provider.execute(tool.name, args, context);
      } else if (typeof tool.execute === 'function') {
        result = await tool.execute(args, context);
      } else {
        throw new Error(`Tool "${toolName}" has no execution handler`);
      }

      const duration = Date.now() - startTime;
      this.emit('tool_executed', { 
        tool: toolName, 
        success: true, 
        duration 
      });

      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (err) {
      this.emit('tool_executed', { 
        tool: toolName, 
        success: false, 
        error: err.message 
      });
      return JSON.stringify({
        success: false,
        error: `Tool execution error: ${err.message}`,
      });
    }
  }

  /**
   * Get OpenAI-compatible function schemas for a set of tool refs
   * @param {string[]} toolRefs — Array of tool references from manifest
   * @returns {Object[]} — Array of OpenAI function schemas
   */
  getSchemasForRefs(toolRefs) {
    const schemas = [];

    for (const ref of toolRefs) {
      const tool = this.resolve(ref);
      if (!tool) {
        console.warn(`[ToolRegistry] Tool ref "${ref}" not resolved — skipping schema`);
        continue;
      }

      schemas.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || `Tool: ${tool.name}`,
          parameters: tool.schema || { type: 'object', properties: {} },
        },
      });
    }

    return schemas;
  }

  /**
   * Get all available tool schemas (for listing)
   * @returns {Object[]}
   */
  getAllSchemas() {
    return this.getSchemasForRefs([...this.tools.keys()]);
  }

  /**
   * List all registered tools with metadata
   * @returns {Object[]}
   */
  listTools() {
    const list = [];
    for (const [qualifiedName, tool] of this.tools) {
      const provider = this.toolProviderMap.get(qualifiedName) || 'unknown';
      list.push({
        name: qualifiedName,
        shortName: tool.name,
        description: tool.description || '',
        provider,
        hasSchema: !!tool.schema,
      });
    }
    return list;
  }

  /**
   * Check if all required tools are available
   * @param {string[]} required — Required tool refs
   * @returns {{ satisfied: boolean, missing: string[] }}
   */
  checkRequirements(required) {
    const missing = [];
    for (const ref of required) {
      if (!this.resolve(ref)) {
        missing.push(ref);
      }
    }
    return {
      satisfied: missing.length === 0,
      missing,
    };
  }
}

/**
 * @typedef {Object} ResolvedTool
 * @property {string} name
 * @property {string} description
 * @property {Object} schema - JSON Schema for parameters
 * @property {Function} [execute] - Direct execution function
 */

module.exports = ToolRegistry;
