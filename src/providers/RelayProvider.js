/**
 * RelayProvider — Bridge to external relay service
 * 
 * Connects agent tools to a relay infrastructure for
 * OS-level capabilities: file system, terminal, browser, WhatsApp, etc.
 * 
 * This is a thin adapter that maps relay capability domains to tools
 * the agent can call. Rate-limited for safety.
 */

const RELAY_DOMAINS = {
  file: {
    description: 'File system operations (read, write, edit, list, search, delete)',
    tools: [
      { name: 'read_file', description: 'Read file contents', params: { file_path: 'string' }, operation: 'READ_FILE' },
      { name: 'write_file', description: 'Write content to a file', params: { file_path: 'string', content: 'string' }, operation: 'WRITE_FILE' },
      { name: 'list_directory', description: 'List directory contents', params: { file_path: 'string' }, operation: 'LIST_DIRECTORY' },
      { name: 'search_files', description: 'Search for files by pattern', params: { pattern: 'string', path: 'string' }, operation: 'SEARCH_FILES' },
      { name: 'delete_file', description: 'Delete a file', params: { file_path: 'string' }, operation: 'DELETE_FILE' },
    ],
  },
  terminal: {
    description: 'Terminal command execution',
    tools: [
      { name: 'execute_command', description: 'Run a terminal command', params: { command: 'string', cwd: 'string' }, operation: 'EXECUTE_COMMAND' },
      { name: 'get_terminal_output', description: 'Get output from a terminal', params: { terminalId: 'string' }, operation: 'GET_OUTPUT' },
    ],
  },
  whatsapp: {
    description: 'WhatsApp Desktop automation (macOS)',
    tools: [
      { name: 'send_whatsapp', description: 'Send a WhatsApp message', params: { contact: 'string', message: 'string' }, operation: 'SEND_MESSAGE' },
      { name: 'read_whatsapp', description: 'Read recent messages from a contact', params: { contact: 'string', count: 'number' }, operation: 'READ_MESSAGES' },
      { name: 'list_whatsapp_chats', description: 'List recent WhatsApp chats', params: {}, operation: 'LIST_CHATS' },
      { name: 'whatsapp_unread', description: 'Check for unread WhatsApp messages', params: {}, operation: 'GET_UNREAD' },
      { name: 'search_whatsapp_contacts', description: 'Search WhatsApp contacts', params: { query: 'string' }, operation: 'SEARCH_CONTACTS' },
    ],
  },
  browser: {
    description: 'Browser automation via Puppeteer/Playwright',
    tools: [
      { name: 'browser_navigate', description: 'Navigate to a URL', params: { url: 'string' }, operation: 'NAVIGATE' },
      { name: 'browser_click', description: 'Click an element', params: { selector: 'string' }, operation: 'CLICK' },
      { name: 'browser_type', description: 'Type text into an element', params: { selector: 'string', text: 'string' }, operation: 'TYPE' },
      { name: 'browser_screenshot', description: 'Take a screenshot', params: {}, operation: 'SCREENSHOT' },
    ],
  },
  api: {
    description: 'HTTP API requests from user machine',
    tools: [
      { name: 'http_request', description: 'Make an HTTP request', params: { method: 'string', url: 'string', headers: 'object', body: 'any' }, operation: 'SEND_REQUEST' },
    ],
  },
};

// Max relay operations per agent execution
const MAX_OPS_PER_EXECUTION = 50;

class RelayProvider {
  /**
   * @param {Object} options
   * @param {Object} options.relayManager — relay manager instance
   * @param {string[]} [options.enabledDomains] — Which domains to expose (default: all)
   */
  constructor({ relayManager, enabledDomains = null }) {
    this.name = 'relay';
    this.relayManager = relayManager;
    this.enabledDomains = enabledDomains 
      ? new Set(enabledDomains) 
      : new Set(Object.keys(RELAY_DOMAINS));
    this.opCount = new Map(); // executionId → count
  }

  /**
   * Discover available relay tools
   * Only returns tools for domains the relay provider supports
   * @returns {Object[]}
   */
  async discover() {
    const tools = [];
    for (const [domain, config] of Object.entries(RELAY_DOMAINS)) {
      if (!this.enabledDomains.has(domain)) continue;

      for (const tool of config.tools) {
        tools.push({
          name: tool.name,
          description: `[Relay:${domain}] ${tool.description}`,
          schema: this._buildSchema(tool),
          _domain: domain,
          _operation: tool.operation,
        });
      }
    }
    return tools;
  }

  /**
   * Execute a relay tool
   * @param {string} toolName 
   * @param {Object} args 
   * @param {Object} context — Must contain { sessionId }
   * @returns {string}
   */
  async execute(toolName, args, context = {}) {
    const { sessionId, executionId } = context;

    if (!sessionId) {
      throw new Error('Relay operations require a sessionId (Electron app must be connected)');
    }

    // Rate limiting per execution
    const execKey = executionId || 'default';
    const count = (this.opCount.get(execKey) || 0) + 1;
    if (count > MAX_OPS_PER_EXECUTION) {
      throw new Error(`Relay operation limit exceeded (${MAX_OPS_PER_EXECUTION} max per agent execution)`);
    }
    this.opCount.set(execKey, count);

    // Find the tool config
    let toolConfig = null;
    let domain = null;
    for (const [d, config] of Object.entries(RELAY_DOMAINS)) {
      const found = config.tools.find(t => t.name === toolName);
      if (found) {
        toolConfig = found;
        domain = d;
        break;
      }
    }

    if (!toolConfig) {
      throw new Error(`Unknown relay tool: ${toolName}`);
    }

    // Execute through relay manager
    const result = await this.relayManager.execute(
      domain,
      toolConfig.operation,
      args,
      sessionId,
      30000 // 30s timeout
    );

    return JSON.stringify(result);
  }

  /**
   * Build OpenAI-compatible parameter schema for a relay tool
   * @private
   */
  _buildSchema(tool) {
    const properties = {};
    for (const [key, type] of Object.entries(tool.params || {})) {
      properties[key] = { type: type === 'any' ? 'string' : type };
    }
    return {
      type: 'object',
      properties,
      required: Object.keys(properties).filter(k => !['cwd', 'count', 'headers', 'body'].includes(k)),
    };
  }

  /**
   * Reset operation count for an execution (call when execution completes)
   */
  resetOpCount(executionId) {
    this.opCount.delete(executionId || 'default');
  }
}

module.exports = RelayProvider;
