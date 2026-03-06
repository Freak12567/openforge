/**
 * BuiltinProvider — Built-in utility tools
 * 
 * Standard tools bundled with every agent:
 *   - http_fetch: Make HTTP requests
 *   - json_parse: Parse/extract from JSON
 *   - text_transform: String manipulation
 *   - date_time: Date/time operations
 *   - wait: Sleep for a specified duration
 */

class BuiltinProvider {
  constructor() {
    this.name = 'builtin';
    this._tools = [
      {
        name: 'http_fetch',
        description: 'Make an HTTP request to any URL. Returns response body, status, and headers.',
        schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to fetch' },
            method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], description: 'HTTP method (default: GET)' },
            headers: { type: 'object', description: 'Request headers' },
            body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
            timeout: { type: 'number', description: 'Timeout in ms (default: 15000)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'json_parse',
        description: 'Parse a JSON string and optionally extract a value by path (dot notation).',
        schema: {
          type: 'object',
          properties: {
            json: { type: 'string', description: 'JSON string to parse' },
            path: { type: 'string', description: 'Dot-notation path to extract (e.g., "data.users[0].name")' },
          },
          required: ['json'],
        },
      },
      {
        name: 'text_transform',
        description: 'Transform text: uppercase, lowercase, trim, replace, split, join, truncate, count.',
        schema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Input text' },
            operation: { type: 'string', enum: ['uppercase', 'lowercase', 'trim', 'replace', 'split', 'join', 'truncate', 'count_words', 'count_chars', 'extract_emails', 'extract_urls'], description: 'Operation to perform' },
            find: { type: 'string', description: 'Find string (for replace)' },
            replaceWith: { type: 'string', description: 'Replacement string (for replace)' },
            delimiter: { type: 'string', description: 'Delimiter (for split/join)' },
            maxLength: { type: 'number', description: 'Max length (for truncate)' },
          },
          required: ['text', 'operation'],
        },
      },
      {
        name: 'date_time',
        description: 'Get current date/time, calculate date differences, format dates.',
        schema: {
          type: 'object',
          properties: {
            operation: { type: 'string', enum: ['now', 'format', 'diff', 'add', 'parse'], description: 'Operation' },
            date: { type: 'string', description: 'Date string to operate on' },
            format: { type: 'string', description: 'Format string (ISO, locale, custom)' },
            timezone: { type: 'string', description: 'Timezone (e.g., "America/New_York")' },
            amount: { type: 'number', description: 'Amount to add (for add operation)' },
            unit: { type: 'string', enum: ['seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'], description: 'Unit for add operation' },
          },
          required: ['operation'],
        },
      },
      {
        name: 'wait',
        description: 'Pause execution for a specified duration (max 30 seconds).',
        schema: {
          type: 'object',
          properties: {
            ms: { type: 'number', description: 'Milliseconds to wait (max 30000)' },
          },
          required: ['ms'],
        },
      },
    ];
  }

  /**
   * @returns {Object[]}
   */
  async discover() {
    return this._tools;
  }

  /**
   * Execute a built-in tool
   */
  async execute(toolName, args, context = {}) {
    switch (toolName) {
      case 'http_fetch':
        return await this._httpFetch(args);
      case 'json_parse':
        return this._jsonParse(args);
      case 'text_transform':
        return this._textTransform(args);
      case 'date_time':
        return this._dateTime(args);
      case 'wait':
        return await this._wait(args);
      default:
        throw new Error(`Unknown built-in tool: ${toolName}`);
    }
  }

  // ── Tool implementations ──

  async _httpFetch(args) {
    const { url, method = 'GET', headers = {}, body, timeout = 15000 } = args;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const options = {
        method,
        headers,
        signal: controller.signal,
      };
      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        options.body = body;
        if (!headers['Content-Type']) {
          options.headers['Content-Type'] = 'application/json';
        }
      }

      const response = await fetch(url, options);
      const text = await response.text();

      return JSON.stringify({
        success: true,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: text.length > 50000 ? text.substring(0, 50000) + '... [truncated]' : text,
      });
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err.name === 'AbortError' ? `Request timed out after ${timeout}ms` : err.message,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  _jsonParse(args) {
    const { json, path } = args;
    try {
      let parsed = JSON.parse(json);
      if (path) {
        parsed = this._getByPath(parsed, path);
      }
      return JSON.stringify({ success: true, result: parsed });
    } catch (err) {
      return JSON.stringify({ success: false, error: `JSON parse error: ${err.message}` });
    }
  }

  _textTransform(args) {
    const { text, operation, find, replaceWith, delimiter, maxLength } = args;
    let result;

    switch (operation) {
      case 'uppercase': result = text.toUpperCase(); break;
      case 'lowercase': result = text.toLowerCase(); break;
      case 'trim': result = text.trim(); break;
      case 'replace': result = text.replaceAll(find || '', replaceWith || ''); break;
      case 'split': result = text.split(delimiter || '\n'); break;
      case 'join': result = (Array.isArray(text) ? text : [text]).join(delimiter || ', '); break;
      case 'truncate': result = text.substring(0, maxLength || 100); break;
      case 'count_words': result = text.split(/\s+/).filter(Boolean).length; break;
      case 'count_chars': result = text.length; break;
      case 'extract_emails': result = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []; break;
      case 'extract_urls': result = text.match(/https?:\/\/[^\s<>"]+/g) || []; break;
      default: result = text;
    }

    return JSON.stringify({ success: true, result });
  }

  _dateTime(args) {
    const { operation, date, timezone, amount, unit } = args;

    switch (operation) {
      case 'now': {
        const now = new Date();
        return JSON.stringify({
          success: true,
          iso: now.toISOString(),
          unix: now.getTime(),
          locale: now.toLocaleString('en-US', timezone ? { timeZone: timezone } : {}),
        });
      }
      case 'format': {
        const d = new Date(date || Date.now());
        return JSON.stringify({
          success: true,
          iso: d.toISOString(),
          locale: d.toLocaleString('en-US', timezone ? { timeZone: timezone } : {}),
        });
      }
      case 'diff': {
        const d1 = new Date(date);
        const d2 = new Date();
        const diffMs = d2 - d1;
        return JSON.stringify({
          success: true,
          milliseconds: diffMs,
          seconds: Math.round(diffMs / 1000),
          minutes: Math.round(diffMs / 60000),
          hours: Math.round(diffMs / 3600000),
          days: Math.round(diffMs / 86400000),
        });
      }
      case 'add': {
        const d = new Date(date || Date.now());
        const multipliers = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 };
        if (unit === 'months') d.setMonth(d.getMonth() + (amount || 0));
        else if (unit === 'years') d.setFullYear(d.getFullYear() + (amount || 0));
        else d.setTime(d.getTime() + (amount || 0) * (multipliers[unit] || 1000));
        return JSON.stringify({ success: true, result: d.toISOString() });
      }
      case 'parse': {
        const d = new Date(date);
        return JSON.stringify({
          success: true,
          valid: !isNaN(d.getTime()),
          iso: !isNaN(d.getTime()) ? d.toISOString() : null,
          unix: !isNaN(d.getTime()) ? d.getTime() : null,
        });
      }
      default:
        return JSON.stringify({ success: false, error: `Unknown date_time operation: ${operation}` });
    }
  }

  async _wait(args) {
    const ms = Math.min(args.ms || 1000, 30000); // Cap at 30s
    await new Promise(resolve => setTimeout(resolve, ms));
    return JSON.stringify({ success: true, waited: ms });
  }

  /**
   * Navigate a nested object by dot-notation path
   * @private
   */
  _getByPath(obj, path) {
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = obj;
    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }
    return current;
  }
}

module.exports = BuiltinProvider;
