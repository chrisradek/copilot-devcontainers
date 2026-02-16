import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as url from "node:url";

export interface InitOptions {
  scope: "repo" | "user";
  dir: string;
  force?: boolean;
}

interface McpConfig {
  mcpServers?: Record<string, unknown>;
}

const MCP_SERVER_ENTRY = {
  type: "stdio",
  command: "npx",
  args: ["-y", "-p", "@cjradek/copilot-sandbox@latest", "copilot-sandbox-mcp"],
  tools: ["*"],
};

function readOrchestratorAgent(): string {
  const agentPath = path.resolve(
    url.fileURLToPath(import.meta.url),
    "../../.github/agents/orchestrator.agent.md",
  );
  return fs.readFileSync(agentPath, "utf-8");
}

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function resolvePaths(options: InitOptions): { mcpConfigPath: string; agentPath: string } {
  if (options.scope === "user") {
    const base = path.join(os.homedir(), ".copilot");
    return {
      mcpConfigPath: path.join(base, "mcp-config.json"),
      agentPath: path.join(base, "agents", "orchestrator.agent.md"),
    };
  }

  // Repo scope: MCP config goes in .copilot/, agents go in .github/agents/
  const dir = path.resolve(options.dir);
  return {
    mcpConfigPath: path.join(dir, ".copilot", "mcp-config.json"),
    agentPath: path.join(dir, ".github", "agents", "orchestrator.agent.md"),
  };
}

function writeMcpConfig(mcpConfigPath: string, force?: boolean): void {
  fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true });

  let config: McpConfig = {};
  let existed = false;

  if (fs.existsSync(mcpConfigPath)) {
    const existing = fs.readFileSync(mcpConfigPath, "utf-8");
    config = JSON.parse(existing) as McpConfig;

    if (config.mcpServers?.["copilot-sandbox"] && !force) {
      log(`  MCP server already configured in ${mcpConfigPath} — skipping`);
      return;
    }

    existed = !!config.mcpServers?.["copilot-sandbox"];
  }

  config.mcpServers = config.mcpServers ?? {};
  config.mcpServers["copilot-sandbox"] = MCP_SERVER_ENTRY;

  fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2) + "\n");
  
  if (force && existed) {
    log(`  ✓ MCP config updated: ${mcpConfigPath}`);
  } else {
    log(`  ✓ MCP config: ${mcpConfigPath}`);
  }
}

function writeAgent(agentPath: string, force?: boolean): void {
  fs.mkdirSync(path.dirname(agentPath), { recursive: true });

  const existed = fs.existsSync(agentPath);

  if (existed && !force) {
    log(`  Agent already exists at ${agentPath} — skipping`);
    return;
  }

  fs.writeFileSync(agentPath, readOrchestratorAgent());
  
  if (force && existed) {
    log(`  ✓ Agent updated: ${agentPath}`);
  } else {
    log(`  ✓ Agent: ${agentPath}`);
  }
}

export function initSandbox(options: InitOptions): void {
  const scopeLabel = options.scope === "user" ? "user (~/.copilot)" : `repo (${path.resolve(options.dir)})`;
  log(`Initializing copilot-sandbox for ${scopeLabel}...${options.force ? " (force)" : ""}\n`);

  const { mcpConfigPath, agentPath } = resolvePaths(options);

  writeMcpConfig(mcpConfigPath, options.force);
  writeAgent(agentPath, options.force);

  log(`\nDone! The orchestrator agent is now available via @orchestrator.`);
}
