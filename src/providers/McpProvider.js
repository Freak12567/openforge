/**
 * MCP Provider — Model Context Protocol client
 * 
 * Connects to MCP servers and discovers/executes their tools.
 * Supports all 3 MCP transports:
 *   - stdio: Spawns a child process, communicates via stdin/stdout
 *   - SSE: Server-Sent Events over HTTP
 *   - WebSocket: Persistent WebSocket connection
 * 
 * Protocol: JSON-RPC 2.0 over the chosen transport
 * 
 * Reference: https://modelcontextprotocol.io/specification
 */

const { spawn } = require('child_process');
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

// ============================================================================
// Transport Implementations
// ============================================================================

/**
 * Stdio Transport — spawn a process and communicate via stdin/stdout
 */
class StdioTransport extends EventEmitter {
  constructor(command, args = [], env = {}) {
    super();
    this.command = command;
    this.args = args;
    this.env = { ...process.env, ...env };
    this.process = null;
    this.buffer = '';
    this.connected = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.command, this.args, {
        env: this.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout.on('data', (data) => {
        this.buffer += data.toString();
        this._processBuffer();
      });

      this.process.stderr.on('data', (data) => {
        console.warn(`[MCP:stdio:stderr] ${data.toString().trim()}`);
      });

      this.process.on('error', (err) => {
        this.connected = false;
        this.emit('error', err);
        reject(err);
      });

      this.process.on('close', (code) => {
        this.connected = false;
        this.emit('close', code);
      });

      // Give the process a moment to start
      setTimeout(() => {
        this.connected = true;
        resolve();
      }, 500);
    });
  }

  _processBuffer() {
    // JSON-RPC messages are newline-delimited
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const message = JSON.parse(trimmed);
        this.emit('message', message);
      } catch (e) {
        // Not JSON — might be logging output, skip
      }
    }
  }

  send(message) {
    if (!this.process || !this.connected) {
      throw new Error('Stdio transport not connected');
    }
    this.process.stdin.write(JSON.stringify(message) + '\n');
  }

  async disconnect() {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.connected = false;
  }
}

/**
 * SSE Transport — Server-Sent Events over HTTP
 */
class SSETransport extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.eventSource = null;
    this.postEndpoint = null; // Discovered from SSE endpoint event
    this.connected = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        const EventSource = require('eventsource');
        this.eventSource = new EventSource(this.url);

        this.eventSource.addEventListener('endpoint', (event) => {
          // MCP SSE protocol: server sends an 'endpoint' event with POST URL
          this.postEndpoint = event.data;
          if (this.postEndpoint.startsWith('/')) {
            const urlObj = new URL(this.url);
            this.postEndpoint = `${urlObj.origin}${this.postEndpoint}`;
          }
          this.connected = true;
          resolve();
        });

        this.eventSource.addEventListener('message', (event) => {
          try {
            const message = JSON.parse(event.data);
            this.emit('message', message);
          } catch (e) {
            console.warn('[MCP:SSE] Non-JSON message:', event.data);
          }
        });

        this.eventSource.onerror = (err) => {
          if (!this.connected) {
            reject(new Error(`SSE connection failed to ${this.url}`));
          }
          this.emit('error', err);
        };

        // Timeout if no endpoint event received
        setTimeout(() => {
          if (!this.connected) {
            this.disconnect();
            reject(new Error(`SSE endpoint discovery timed out for ${this.url}`));
          }
        }, 10000);
      } catch (err) {
        reject(err);
      }
    });
  }

  async send(message) {
    if (!this.postEndpoint) {
      throw new Error('SSE transport not connected — no POST endpoint discovered');
    }
    const response = await fetch(this.postEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      throw new Error(`SSE POST failed: ${response.status}`);
    }
  }

  async disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connected = false;
  }
}

/**
 * WebSocket Transport — persistent WS connection
 */
class WebSocketTransport extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.connected = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const WebSocket = require('ws');
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        this.connected = true;
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.emit('message', message);
        } catch (e) {
          console.warn('[MCP:WS] Non-JSON message:', data.toString().substring(0, 100));
        }
      });

      this.ws.on('error', (err) => {
        if (!this.connected) reject(err);
        this.emit('error', err);
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.emit('close');
      });

      setTimeout(() => {
        if (!this.connected) {
          this.ws?.terminate();
          reject(new Error(`WebSocket connection timed out for ${this.url}`));
        }
      }, 10000);
    });
  }

  send(message) {
    if (!this.ws || !this.connected) {
      throw new Error('WebSocket transport not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  async disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}

// ============================================================================
// MCP Client — Wraps transport with JSON-RPC protocol
// ============================================================================

class McpClient extends EventEmitter {
  constructor(serverName, config) {
    super();
    this.serverName = serverName;
    this.config = config;
    this.transport = null;
    this.tools = [];
    this.pendingRequests = new Map();
  }

  /**
   * Connect to the MCP server
   */
  async connect() {
    const { transport: type } = this.config;

    switch (type) {
      case 'stdio':
        this.transport = new StdioTransport(
          this.config.command,
          this.config.args || [],
          this.config.env || {}
        );
        break;
      case 'sse':
        this.transport = new SSETransport(this.config.url);
        break;
      case 'websocket':
      case 'ws':
        this.transport = new WebSocketTransport(this.config.url);
        break;
      default:
        throw new Error(`Unknown MCP transport: ${type}`);
    }

    this.transport.on('message', (msg) => this._handleMessage(msg));
    this.transport.on('error', (err) => {
      console.error(`[MCP:${this.serverName}] Transport error:`, err.message);
    });

    await this.transport.connect();
    console.log(`[MCP:${this.serverName}] Connected via ${type}`);

    // Initialize MCP session
    await this._initialize();
  }

  /**
   * MCP initialize handshake
   */
  async _initialize() {
    const result = await this._request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'openforge',
        version: '0.1.0',
      },
    });

    console.log(`[MCP:${this.serverName}] Initialized:`, result?.serverInfo?.name || 'unknown');

    // Send initialized notification
    this._notify('notifications/initialized', {});
  }

  /**
   * Discover available tools from the MCP server
   * @returns {Object[]} — Array of { name, description, schema }
   */
  async discoverTools() {
    const result = await this._request('tools/list', {});
    this.tools = (result?.tools || []).map(tool => ({
      name: tool.name,
      description: tool.description || '',
      schema: tool.inputSchema || { type: 'object', properties: {} },
    }));

    console.log(`[MCP:${this.serverName}] Discovered ${this.tools.length} tools`);
    return this.tools;
  }

  /**
   * Execute a tool on the MCP server
   * @param {string} toolName 
   * @param {Object} args 
   * @returns {string} — Stringified result
   */
  async executeTool(toolName, args) {
    const result = await this._request('tools/call', {
      name: toolName,
      arguments: args,
    });

    // MCP returns content array
    if (result?.content) {
      return result.content
        .map(c => c.type === 'text' ? c.text : JSON.stringify(c))
        .join('\n');
    }

    return JSON.stringify(result);
  }

  /**
   * Send a JSON-RPC request and wait for response
   * @private
   */
  async _request(method, params, timeoutMs = 30000) {
    const id = uuidv4();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.transport.send({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   * @private
   */
  _notify(method, params) {
    this.transport.send({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  /**
   * Handle incoming messages from transport
   * @private
   */
  _handleMessage(msg) {
    // Response to a request
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const { resolve, reject, timeout } = this.pendingRequests.get(msg.id);
      clearTimeout(timeout);
      this.pendingRequests.delete(msg.id);

      if (msg.error) {
        reject(new Error(`MCP error: ${msg.error.message || JSON.stringify(msg.error)}`));
      } else {
        resolve(msg.result);
      }
      return;
    }

    // Server-initiated notification
    if (msg.method) {
      this.emit('notification', { method: msg.method, params: msg.params });
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect() {
    if (this.transport) {
      await this.transport.disconnect();
    }
    // Reject any pending requests
    for (const [id, { reject, timeout }] of this.pendingRequests) {
      clearTimeout(timeout);
      reject(new Error('MCP client disconnected'));
    }
    this.pendingRequests.clear();
  }
}

// ============================================================================
// MCP Provider — ToolRegistry-compatible interface
// ============================================================================

class McpProvider {
  constructor() {
    this.name = 'mcp';
    /** @type {Map<string, McpClient>} */
    this.clients = new Map();
    /** @type {Map<string, string>} toolName → serverName */
    this.toolServerMap = new Map();
  }

  /**
   * Add an MCP server configuration
   * @param {string} serverName — Unique server identifier
   * @param {Object} config — { transport, command?, args?, url?, env? }
   */
  async addServer(serverName, config) {
    const client = new McpClient(serverName, config);
    await client.connect();
    this.clients.set(serverName, client);

    // Discover tools
    const tools = await client.discoverTools();
    for (const tool of tools) {
      this.toolServerMap.set(tool.name, serverName);
    }

    console.log(`[McpProvider] Server "${serverName}" added with ${tools.length} tools`);
  }

  /**
   * Remove an MCP server
   * @param {string} serverName 
   */
  async removeServer(serverName) {
    const client = this.clients.get(serverName);
    if (client) {
      await client.disconnect();
      this.clients.delete(serverName);
      // Remove tool mappings
      for (const [tool, server] of this.toolServerMap) {
        if (server === serverName) this.toolServerMap.delete(tool);
      }
    }
  }

  /**
   * Discover all tools from all connected MCP servers
   * Implements ToolProvider interface
   * @returns {Object[]}
   */
  async discover() {
    const allTools = [];
    for (const [serverName, client] of this.clients) {
      try {
        const tools = await client.discoverTools();
        for (const tool of tools) {
          allTools.push({
            name: tool.name,
            description: `[MCP:${serverName}] ${tool.description}`,
            schema: tool.schema,
            _server: serverName,
          });
          this.toolServerMap.set(tool.name, serverName);
        }
      } catch (err) {
        console.error(`[McpProvider] Failed to discover from ${serverName}:`, err.message);
      }
    }
    return allTools;
  }

  /**
   * Execute a tool on the appropriate MCP server
   * Implements ToolProvider interface
   * @param {string} toolName 
   * @param {Object} args 
   * @param {Object} context 
   * @returns {string}
   */
  async execute(toolName, args, context = {}) {
    const serverName = this.toolServerMap.get(toolName);
    if (!serverName) {
      throw new Error(`No MCP server registered for tool: ${toolName}`);
    }

    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server "${serverName}" not connected`);
    }

    return await client.executeTool(toolName, args);
  }

  /**
   * List all connected servers and their tools
   */
  listServers() {
    const servers = [];
    for (const [name, client] of this.clients) {
      servers.push({
        name,
        transport: client.config.transport,
        tools: client.tools.map(t => t.name),
        connected: client.transport?.connected || false,
      });
    }
    return servers;
  }

  /**
   * Disconnect all servers
   */
  async disconnectAll() {
    for (const [name, client] of this.clients) {
      await client.disconnect();
    }
    this.clients.clear();
    this.toolServerMap.clear();
  }
}

module.exports = { McpProvider, McpClient, StdioTransport, SSETransport, WebSocketTransport };
