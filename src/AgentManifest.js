/**
 * AgentManifest — Parse and validate .agent.json files
 * 
 * Every agent is defined by a single manifest file. No database required.
 * Supports both JSON (.agent.json) and YAML (.agent.yaml) formats.
 */

const fs = require('fs');
const path = require('path');

// Default runtime config
const RUNTIME_DEFAULTS = {
  model: 'gpt-4o-mini',
  maxLoops: 10,
  timeoutMs: 60000,
};

// Required manifest fields
const REQUIRED_FIELDS = ['name', 'description', 'systemPrompt'];

// Valid trigger types
const VALID_TRIGGER_TYPES = ['manual', 'schedule', 'events'];

// Valid panel layouts
const VALID_PANELS = ['chat', 'full', 'split', 'modal'];

class AgentManifest {
  /**
   * @param {Object} raw — Raw parsed manifest object
   * @param {string} basePath — Absolute path to the agent directory
   */
  constructor(raw, basePath) {
    this.raw = raw;
    this.basePath = basePath;
    this._validated = false;
  }

  /**
   * Load manifest from a directory
   * @param {string} agentDir — Absolute path to agent directory
   * @returns {AgentManifest}
   */
  static fromDirectory(agentDir) {
    const jsonPath = path.join(agentDir, '.agent.json');
    const yamlPath = path.join(agentDir, '.agent.yaml');
    const ymlPath = path.join(agentDir, '.agent.yml');

    let raw;
    let manifestPath;

    if (fs.existsSync(jsonPath)) {
      manifestPath = jsonPath;
      const content = fs.readFileSync(jsonPath, 'utf8');
      raw = JSON.parse(content);
    } else if (fs.existsSync(yamlPath) || fs.existsSync(ymlPath)) {
      manifestPath = fs.existsSync(yamlPath) ? yamlPath : ymlPath;
      try {
        const yaml = require('yaml');
        const content = fs.readFileSync(manifestPath, 'utf8');
        raw = yaml.parse(content);
      } catch (err) {
        throw new Error(`Failed to parse YAML manifest at ${manifestPath}: ${err.message}`);
      }
    } else {
      throw new Error(`No agent manifest found in ${agentDir}. Expected .agent.json or .agent.yaml`);
    }

    const manifest = new AgentManifest(raw, agentDir);
    manifest.validate();
    return manifest;
  }

  /**
   * Create manifest from a raw object (for programmatic creation)
   * @param {Object} config 
   * @param {string} basePath 
   * @returns {AgentManifest}
   */
  static fromObject(config, basePath = null) {
    const manifest = new AgentManifest(config, basePath || process.cwd());
    manifest.validate();
    return manifest;
  }

  /**
   * Validate the manifest and throw on errors
   */
  validate() {
    const errors = [];
    const r = this.raw;

    // Required fields
    for (const field of REQUIRED_FIELDS) {
      if (!r[field]) {
        errors.push(`Missing required field: "${field}"`);
      }
    }

    // Name format
    if (r.name && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(r.name) && r.name.length > 1) {
      errors.push(`Invalid agent name "${r.name}". Must be lowercase alphanumeric with hyphens (e.g., "my-agent").`);
    }

    // Version semver
    if (r.version && !/^\d+\.\d+\.\d+/.test(r.version)) {
      errors.push(`Invalid version "${r.version}". Must be semver (e.g., "1.0.0").`);
    }

    // Runtime config
    if (r.runtime) {
      if (r.runtime.maxLoops && (typeof r.runtime.maxLoops !== 'number' || r.runtime.maxLoops < 1 || r.runtime.maxLoops > 100)) {
        errors.push(`runtime.maxLoops must be 1-100, got ${r.runtime.maxLoops}`);
      }
      if (r.runtime.timeoutMs && (typeof r.runtime.timeoutMs !== 'number' || r.runtime.timeoutMs < 1000)) {
        errors.push(`runtime.timeoutMs must be >= 1000ms`);
      }
    }

    // Tools config
    if (r.tools) {
      if (r.tools.require && !Array.isArray(r.tools.require)) {
        errors.push(`tools.require must be an array`);
      }
      if (r.tools.optional && !Array.isArray(r.tools.optional)) {
        errors.push(`tools.optional must be an array`);
      }
      if (r.tools.custom && !Array.isArray(r.tools.custom)) {
        errors.push(`tools.custom must be an array`);
      }
      // Validate custom tool definitions
      if (Array.isArray(r.tools.custom)) {
        for (const tool of r.tools.custom) {
          if (!tool.name) errors.push(`Custom tool missing "name"`);
          if (!tool.description) errors.push(`Custom tool "${tool.name || '?'}" missing "description"`);
          if (tool.handler && !fs.existsSync(path.resolve(this.basePath, tool.handler))) {
            errors.push(`Custom tool "${tool.name}" handler not found: ${tool.handler}`);
          }
        }
      }
    }

    // UI config
    if (r.ui && r.ui.panel && !VALID_PANELS.includes(r.ui.panel)) {
      errors.push(`ui.panel must be one of: ${VALID_PANELS.join(', ')}`);
    }

    if (errors.length > 0) {
      throw new Error(`Agent manifest validation failed:\n  - ${errors.join('\n  - ')}`);
    }

    this._validated = true;
  }

  // ── Getters ──

  get name() { return this.raw.name; }
  get version() { return this.raw.version || '0.0.1'; }
  get description() { return this.raw.description || ''; }
  get author() { return this.raw.author || 'unknown'; }
  get license() { return this.raw.license || 'MIT'; }
  get systemPrompt() { return this.raw.systemPrompt || ''; }

  get runtime() {
    return {
      ...RUNTIME_DEFAULTS,
      ...(this.raw.runtime || {}),
    };
  }

  get requiredTools() {
    return this.raw.tools?.require || [];
  }

  get optionalTools() {
    return this.raw.tools?.optional || [];
  }

  get customTools() {
    return this.raw.tools?.custom || [];
  }

  get allToolRefs() {
    return [...this.requiredTools, ...this.optionalTools];
  }

  get triggers() {
    return this.raw.triggers || { manual: true };
  }

  get ui() {
    return {
      panel: 'chat',
      icon: '🤖',
      ...(this.raw.ui || {}),
    };
  }

  /**
   * Serialize to JSON (for saving/sharing)
   */
  toJSON() {
    return { ...this.raw };
  }

  /**
   * Save manifest to disk
   * @param {string} targetDir — Directory to save to (defaults to basePath)
   */
  save(targetDir = null) {
    const dir = targetDir || this.basePath;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, '.agent.json');
    fs.writeFileSync(filePath, JSON.stringify(this.toJSON(), null, 2), 'utf8');
    return filePath;
  }
}

module.exports = AgentManifest;
