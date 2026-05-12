import { CircuitBreaker } from "./agent/circuit-breaker.js";

type FetchFn = typeof globalThis.fetch;

export interface SoiferStackHealth {
  status: "ok" | "degraded";
  services: Record<string, { status: string; port?: number; version?: string }>;
}

export interface SoiferMcpServers {
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

export interface SoiferHooks {
  [event: string]: Array<{
    matcher?: string;
    hooks: Array<{ type: string; command: string; timeout?: number }>;
  }>;
}

export interface SoiferPermissions {
  allow: string[];
  deny: string[];
}

export interface SoiferBackendClientOptions {
  baseUrl?: string;
  _fetchForTest?: FetchFn;
  _breakerForTest?: CircuitBreaker;
}

export class SoiferBackendClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;
  private readonly breaker: CircuitBreaker;

  constructor(options?: SoiferBackendClientOptions) {
    this.baseUrl = options?.baseUrl ?? process.env.SOIFER_BACKEND_URL ?? "http://127.0.0.1:3001";
    this.fetchFn = options?._fetchForTest ?? globalThis.fetch;
    this.breaker = options?._breakerForTest ?? new CircuitBreaker();
  }

  getBreakerState(): "closed" | "open" | "half-open" {
    return this.breaker.state;
  }

  private async get<T>(path: string, fallback: T): Promise<T> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    }, fallback);
  }

  async checkHealth(): Promise<{ reachable: boolean }> {
    return this.breaker.execute<{ reachable: boolean }>(
      async () => {
        const response = await this.fetchFn(`${this.baseUrl}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { reachable: true };
      },
      { reachable: false },
    );
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

  async getPlugins(): Promise<{
    enabledPlugins: Record<string, boolean>;
    extraKnownMarketplaces: Record<string, unknown>;
  }> {
    return this.get("/api/stack/claude-cli/plugins", {
      enabledPlugins: {},
      extraKnownMarketplaces: {},
    });
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

  // ── Layout mode preference (AC-17) ──

  async getLayoutMode(): Promise<"workspace" | "claude-desktop"> {
    const result = await this.get<{ layoutMode: "workspace" | "claude-desktop" }>(
      "/api/stack/preferences/layout-mode",
      { layoutMode: "workspace" },
    );
    return result.layoutMode;
  }

  async setLayoutMode(layoutMode: "workspace" | "claude-desktop"): Promise<boolean> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/stack/preferences/layout-mode`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layoutMode }),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    }, false);
  }

  // ── Project management (AC-36+37) ──

  async renameProject(projectId: string, name: string): Promise<boolean> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(
        `${this.baseUrl}/api/stack/projects/${encodeURIComponent(projectId)}/name`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
          signal: AbortSignal.timeout(5000),
        },
      );
      return response.ok;
    }, false);
  }

  async archiveProject(projectId: string, archived: boolean): Promise<boolean> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(
        `${this.baseUrl}/api/stack/projects/${encodeURIComponent(projectId)}/archive`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived }),
          signal: AbortSignal.timeout(5000),
        },
      );
      return response.ok;
    }, false);
  }

  async deleteProject(projectId: string, force = false): Promise<boolean> {
    return this.breaker.execute(async () => {
      const qs = force ? "?force=true" : "";
      const response = await this.fetchFn(
        `${this.baseUrl}/api/stack/projects/${encodeURIComponent(projectId)}${qs}`,
        {
          method: "DELETE",
          signal: AbortSignal.timeout(5000),
        },
      );
      return response.ok;
    }, false);
  }

  // ── Path-based project sync (daemon fire-and-forget) ──

  async renameProjectByPath(projectPath: string, name: string): Promise<boolean> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/stack/projects/by-path/name`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, name }),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    }, false);
  }

  async archiveProjectByPath(projectPath: string, archived: boolean): Promise<boolean> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/stack/projects/by-path/archive`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, archived }),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    }, false);
  }

  // ── Last assistant response (AC-30) ──

  async getLastResponse(sessionId: string): Promise<{
    sessionId: string;
    provider: string;
    text: string | null;
    timestamp: string | null;
  }> {
    return this.get(`/api/stack/sessions/${encodeURIComponent(sessionId)}/last-response`, {
      sessionId,
      provider: "",
      text: null,
      timestamp: null,
    });
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
