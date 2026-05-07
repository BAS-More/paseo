type FetchFn = typeof globalThis.fetch;

export interface SoiferStackHealth {
  status: "ok" | "degraded";
  services: Record<string, { status: string; port?: number; version?: string }>;
}

export interface SoiferMcpServers {
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

export interface SoiferHooks {
  [event: string]: Array<{ matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }> }>;
}

export interface SoiferPermissions {
  allow: string[];
  deny: string[];
}

export interface SoiferBackendClientOptions {
  baseUrl?: string;
  _fetchForTest?: FetchFn;
}

export class SoiferBackendClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;

  constructor(options?: SoiferBackendClientOptions) {
    this.baseUrl = options?.baseUrl ?? process.env.SOIFER_BACKEND_URL ?? "http://127.0.0.1:3001";
    this.fetchFn = options?._fetchForTest ?? globalThis.fetch;
  }

  private async get<T>(path: string, fallback: T): Promise<T> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return fallback;
      return (await response.json()) as T;
    } catch {
      return fallback;
    }
  }

  async checkHealth(): Promise<{ reachable: boolean }> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return { reachable: response.ok };
    } catch {
      return { reachable: false };
    }
  }

  async getStackHealth(): Promise<SoiferStackHealth> {
    return this.get("/api/stack/health", { status: "degraded" as const, services: {} });
  }

  async getMcpServers(): Promise<SoiferMcpServers> {
    return this.get("/api/stack/claude-cli/mcp-servers", { mcpServers: {} });
  }

  async getHooks(): Promise<SoiferHooks> {
    return this.get("/api/stack/claude-cli/hooks", {});
  }

  async getPermissions(): Promise<SoiferPermissions> {
    return this.get("/api/stack/claude-cli/permissions", { allow: [], deny: [] });
  }

  async getSkills(): Promise<string[]> {
    return this.get("/api/stack/claude-cli/skills", []);
  }

  async getAgents(): Promise<Array<{ name: string; content: string }>> {
    return this.get("/api/stack/claude-cli/agents", []);
  }

  async getRules(): Promise<Array<{ name: string; content: string }>> {
    return this.get("/api/stack/claude-cli/rules", []);
  }

  async getPlugins(): Promise<{ enabledPlugins: Record<string, boolean>; extraKnownMarketplaces: Record<string, unknown> }> {
    return this.get("/api/stack/claude-cli/plugins", { enabledPlugins: {}, extraKnownMarketplaces: {} });
  }

  async getCommands(): Promise<Array<{ group: string; name: string; content: string }>> {
    return this.get("/api/stack/claude-cli/commands", []);
  }

  async get9RouterProviders(): Promise<unknown[]> {
    return this.get("/api/stack/9router/providers", []);
  }

  async get9RouterCombos(): Promise<unknown[]> {
    return this.get("/api/stack/9router/combos", []);
  }

  async getCrewAICrews(): Promise<unknown[]> {
    return this.get("/api/stack/crewai/crews", []);
  }

  async getCrewAIAgents(): Promise<unknown[]> {
    return this.get("/api/stack/crewai/agents", []);
  }

  async getFullStatus(): Promise<{
    health: SoiferStackHealth;
    skills: string[];
    agents: Array<{ name: string; content: string }>;
    rules: Array<{ name: string; content: string }>;
    mcpServers: SoiferMcpServers;
    hooks: SoiferHooks;
    permissions: SoiferPermissions;
  }> {
    const [health, skills, agents, rules, mcpServers, hooks, permissions] = await Promise.all([
      this.getStackHealth(),
      this.getSkills(),
      this.getAgents(),
      this.getRules(),
      this.getMcpServers(),
      this.getHooks(),
      this.getPermissions(),
    ]);
    return { health, skills, agents, rules, mcpServers, hooks, permissions };
  }
}
