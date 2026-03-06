/**
 * CustomProvider — Load agent-local JS tool handlers
 * 
 * Custom tools are defined in the agent's .agent.json manifest
 * and their handlers live as JS files within the agent directory.
 * 
 * Handlers are loaded and executed in a sandboxed vm context
 * for security isolation.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SANDBOX_TIMEOUT_MS = 30000;

class CustomProvider {
  constructor() {
    this.name = 'custom';
    /** @type {Map<string, { tool: Object, handler: Function }>} */
    this.loadedTools = new Map();
  }

  /**
   * Load custom tools from an agent manifest
   * @param {AgentManifest} manifest — Agent manifest with customTools
   */
  loadFromManifest(manifest) {
    for (const tool of manifest.customTools) {
      try {
        let handler = null;

        // Option 1: External handler file
        if (tool.handler) {
          const handlerPath = path.resolve(manifest.basePath, tool.handler);
          if (!fs.existsSync(handlerPath)) {
            console.warn(`[CustomProvider] Handler not found: ${handlerPath}`);
            continue;
          }
          const handlerCode = fs.readFileSync(handlerPath, 'utf8');
          handler = this._compileHandler(handlerCode, tool.name, manifest.name);
        }
        // Option 2: Inline handler code in manifest
        else if (tool.handlerCode) {
          handler = this._compileHandler(tool.handlerCode, tool.name, manifest.name);
        }

        if (handler) {
          this.loadedTools.set(tool.name, {
            tool: {
              name: tool.name,
              description: tool.description || `Custom tool: ${tool.name}`,
              schema: tool.parameters || { type: 'object', properties: {} },
            },
            handler,
          });
          console.log(`[CustomProvider] Loaded: ${tool.name} (agent: ${manifest.name})`);
        }
      } catch (err) {
        console.error(`[CustomProvider] Failed to load ${tool.name}:`, err.message);
      }
    }
  }

  /**
   * Discover loaded custom tools
   * @returns {Object[]}
   */
  async discover() {
    return Array.from(this.loadedTools.values()).map(({ tool }) => tool);
  }

  /**
   * Execute a custom tool in sandbox
   * @param {string} toolName 
   * @param {Object} args 
   * @param {Object} context 
   * @returns {string}
   */
  async execute(toolName, args, context = {}) {
    const loaded = this.loadedTools.get(toolName);
    if (!loaded) {
      throw new Error(`Custom tool "${toolName}" not loaded`);
    }

    try {
      const result = await Promise.race([
        Promise.resolve(loaded.handler(args, context)),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Tool "${toolName}" timed out after ${SANDBOX_TIMEOUT_MS}ms`)), SANDBOX_TIMEOUT_MS)
        ),
      ]);

      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: `Custom tool error: ${err.message}`,
      });
    }
  }

  /**
   * Compile handler code into a callable function using vm sandbox
   * @private
   */
  _compileHandler(code, toolName, agentName) {
    const sandbox = this._createSandbox(toolName, agentName);

    const wrappedCode = `
      ${code}
      
      // Capture exported function
      if (typeof module.exports === 'function') {
        __handler__ = module.exports;
      } else if (typeof module.exports.default === 'function') {
        __handler__ = module.exports.default;
      } else if (typeof module.exports.${toolName} === 'function') {
        __handler__ = module.exports.${toolName};
      } else if (typeof handler === 'function') {
        __handler__ = handler;
      } else if (typeof ${toolName} === 'function') {
        __handler__ = ${toolName};
      }
    `;

    sandbox.__handler__ = null;

    const script = new vm.Script(wrappedCode, {
      filename: `${agentName}/${toolName}.js`,
      timeout: SANDBOX_TIMEOUT_MS,
    });

    const ctx = vm.createContext(sandbox);
    script.runInContext(ctx, { timeout: SANDBOX_TIMEOUT_MS });

    if (typeof sandbox.__handler__ !== 'function') {
      throw new Error(`Handler for "${toolName}" did not export a callable function`);
    }

    return sandbox.__handler__;
  }

  /**
   * Create a restricted sandbox context
   * @private
   */
  _createSandbox(toolName, agentName) {
    return {
      console: {
        log: (...args) => console.log(`[Agent:${agentName}/${toolName}]`, ...args),
        warn: (...args) => console.warn(`[Agent:${agentName}/${toolName}]`, ...args),
        error: (...args) => console.error(`[Agent:${agentName}/${toolName}]`, ...args),
      },
      JSON,
      Date,
      Math,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      Promise,
      fetch, // Node 18+ global fetch
      URL,
      URLSearchParams,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, SANDBOX_TIMEOUT_MS)),
      clearTimeout,
      setInterval: (fn, ms) => setInterval(fn, Math.max(ms || 100, 100)),
      clearInterval,
      Buffer: { from: Buffer.from, alloc: Buffer.alloc, isBuffer: Buffer.isBuffer },
      module: { exports: {} },
      exports: {},
    };
  }

  /**
   * Clear all loaded tools
   */
  clear() {
    this.loadedTools.clear();
  }
}

module.exports = CustomProvider;
