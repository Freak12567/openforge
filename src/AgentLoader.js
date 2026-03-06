/**
 * AgentLoader — Dynamic agent discovery and management
 * 
 * Discovers agents from the filesystem, loads their manifests,
 * and provides CRUD operations for the agent registry.
 * 
 * Default agent directory: ~/.openforge/agents/
 * Agents are simple folders with a .agent.json manifest.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const AgentManifest = require('./AgentManifest');

const DEFAULT_AGENT_DIR = path.join(os.homedir(), '.openforge', 'agents');

class AgentLoader {
  /**
   * @param {Object} options
   * @param {string} [options.agentDir] — Custom agent directory
   * @param {string[]} [options.additionalDirs] — Additional directories to scan
   */
  constructor(options = {}) {
    this.agentDir = options.agentDir || DEFAULT_AGENT_DIR;
    this.additionalDirs = options.additionalDirs || [];
    
    /** @type {Map<string, AgentManifest>} */
    this.agents = new Map();
    
    // Ensure agent directory exists
    this._ensureDir(this.agentDir);
  }

  /**
   * Discover all agents from configured directories
   * @returns {Map<string, AgentManifest>}
   */
  discover() {
    this.agents.clear();
    const allDirs = [this.agentDir, ...this.additionalDirs];

    for (const dir of allDirs) {
      if (!fs.existsSync(dir)) continue;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

        const agentPath = path.join(dir, entry.name);
        try {
          const manifest = AgentManifest.fromDirectory(agentPath);
          this.agents.set(manifest.name, manifest);
          console.log(`[AgentLoader] Discovered: ${manifest.name} (${manifest.description.substring(0, 60)})`);
        } catch (err) {
          console.warn(`[AgentLoader] Skipping ${entry.name}: ${err.message}`);
        }
      }
    }

    console.log(`[AgentLoader] Total agents discovered: ${this.agents.size}`);
    return this.agents;
  }

  /**
   * Get an agent manifest by name
   * @param {string} name 
   * @returns {AgentManifest|null}
   */
  get(name) {
    return this.agents.get(name) || null;
  }

  /**
   * List all loaded agents
   * @param {Object} filter — { category?, author? }
   * @returns {Object[]}
   */
  list(filter = {}) {
    const result = [];
    for (const [name, manifest] of this.agents) {
      if (filter.author && manifest.author !== filter.author) continue;
      
      result.push({
        name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        tools: manifest.allToolRefs,
        customTools: manifest.customTools.map(t => t.name),
        triggers: manifest.triggers,
        ui: manifest.ui,
      });
    }
    return result;
  }

  /**
   * Create a new agent from a config object
   * @param {Object} config — Agent manifest config
   * @returns {AgentManifest}
   */
  create(config) {
    if (!config.name) throw new Error('Agent name is required');
    
    const agentDir = path.join(this.agentDir, config.name);
    if (fs.existsSync(agentDir)) {
      throw new Error(`Agent "${config.name}" already exists at ${agentDir}`);
    }

    // Create agent directory
    this._ensureDir(agentDir);

    // Create tools directory if custom tools are defined
    if (config.tools?.custom?.length > 0) {
      this._ensureDir(path.join(agentDir, 'tools'));
      
      // Write custom tool handler stubs
      for (const tool of config.tools.custom) {
        if (tool.handler && tool.handlerCode) {
          const handlerPath = path.join(agentDir, tool.handler);
          this._ensureDir(path.dirname(handlerPath));
          fs.writeFileSync(handlerPath, tool.handlerCode, 'utf8');
          // Remove inline code from manifest (it's now in the file)
          delete tool.handlerCode;
        }
      }
    }

    // Save manifest
    const manifest = AgentManifest.fromObject(config, agentDir);
    manifest.save(agentDir);

    // Add to loaded agents
    this.agents.set(manifest.name, manifest);
    console.log(`[AgentLoader] Created agent: ${manifest.name} at ${agentDir}`);

    return manifest;
  }

  /**
   * Delete an agent
   * @param {string} name 
   * @returns {boolean}
   */
  delete(name) {
    const manifest = this.agents.get(name);
    if (!manifest) return false;

    const agentDir = manifest.basePath;
    if (fs.existsSync(agentDir)) {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }

    this.agents.delete(name);
    console.log(`[AgentLoader] Deleted agent: ${name}`);
    return true;
  }

  /**
   * Update an agent's manifest
   * @param {string} name 
   * @param {Object} updates — Partial config to merge
   * @returns {AgentManifest}
   */
  update(name, updates) {
    const existing = this.agents.get(name);
    if (!existing) throw new Error(`Agent "${name}" not found`);

    const merged = { ...existing.toJSON(), ...updates };
    const updatedManifest = AgentManifest.fromObject(merged, existing.basePath);
    updatedManifest.save();

    this.agents.set(name, updatedManifest);
    console.log(`[AgentLoader] Updated agent: ${name}`);
    return updatedManifest;
  }

  /**
   * Install an agent from a remote source (URL or registry name)
   * @param {string} source — URL to .agent.json or registry package name
   * @returns {Promise<AgentManifest>}
   */
  async install(source) {
    // For now: support URL to a .agent.json or a tar/zip archive
    if (source.startsWith('http://') || source.startsWith('https://')) {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
      
      const config = await response.json();
      return this.create(config);
    }

    // Future: npm-style registry lookup
    throw new Error(`Registry install not yet supported. Use a URL to a .agent.json file.`);
  }

  /**
   * Ensure a directory exists
   * @private
   */
  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

module.exports = AgentLoader;
