import { CircuitBreaker } from "./agent/circuit-breaker.js";

type FetchFn = typeof globalThis.fetch;

export interface NineRouterAccount {
  id: string;
  name: string;
  provider: string;
  status: string;
}

export interface NineRouterUsage {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byAccount: Array<{ id: string; requests: number; tokens: number; cost: number }>;
}

export interface NineRouterStatus {
  reachable: boolean;
  accounts: NineRouterAccount[];
  usage: NineRouterUsage;
}

export interface NineRouterKey {
  id: string;
  name: string;
  key: string;
  machineId: string;
  isActive: boolean;
  createdAt: string;
}

export interface NineRouterModel {
  provider: string;
  model: string;
  name: string;
  fullModel: string;
  alias: string;
}

export interface NineRouterModelTestResult {
  success: boolean;
  latencyMs: number;
  provider: string;
}

export interface NineRouterProvider {
  id: string;
  provider: string;
  authType: string;
  name: string;
  priority: number;
  isActive: boolean;
  testStatus?: string;
  email?: string;
  expiresAt?: string;
  lastUsedAt?: string;
  lastError?: string;
}

export interface NineRouterValidationResult {
  valid: boolean;
  models: number;
  latencyMs: number;
}

export interface NineRouterCombo {
  id: string;
  name: string;
  models: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NineRouterOAuthImportResult {
  success: boolean;
  email?: string;
}

export interface NineRouterCliToolSettings {
  installed: boolean;
  settings: Record<string, unknown>;
  has9Router: boolean;
  settingsPath?: string;
}

export interface NineRouterClientOptions {
  baseUrl?: string;
  _fetchForTest?: FetchFn;
  _breakerForTest?: CircuitBreaker;
}

const EMPTY_USAGE: NineRouterUsage = {
  totalRequests: 0,
  totalTokens: 0,
  totalCost: 0,
  byAccount: [],
};

export class NineRouterClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;
  private readonly breaker: CircuitBreaker;

  constructor(options?: NineRouterClientOptions) {
    this.baseUrl = options?.baseUrl ?? process.env.NINE_ROUTER_URL ?? "http://localhost:20128";
    this.fetchFn = options?._fetchForTest ?? globalThis.fetch;
    this.breaker = options?._breakerForTest ?? new CircuitBreaker();
  }

  /** Exposed for health endpoint / diagnostics. */
  getBreakerState(): "closed" | "open" | "half-open" {
    return this.breaker.state;
  }

  async checkHealth(): Promise<{ reachable: boolean }> {
    return this.breaker.execute<{ reachable: boolean }>(
      async () => {
        const response = await this.fetchFn(`${this.baseUrl}/api/init`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { reachable: true };
      },
      { reachable: false },
    );
  }

  async getAccounts(): Promise<NineRouterAccount[]> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/providers/client`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { connections: NineRouterAccount[] };
      return data.connections ?? [];
    }, []);
  }

  async getUsage(options?: { period?: string }): Promise<NineRouterUsage> {
    return this.breaker.execute(
      async () => {
        const url = options?.period
          ? `${this.baseUrl}/api/usage/stats?period=${options.period}`
          : `${this.baseUrl}/api/usage/stats`;
        const response = await this.fetchFn(url, {
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as {
          totalRequests?: number;
          totalPromptTokens?: number;
          totalCompletionTokens?: number;
          totalCost?: number;
          byAccount?: Record<string, { requests?: number; tokens?: number; cost?: number }>;
        };
        const byAccount = Object.entries(data.byAccount ?? {}).map(([id, stats]) => ({
          id,
          requests: stats.requests ?? 0,
          tokens: stats.tokens ?? 0,
          cost: stats.cost ?? 0,
        }));
        return {
          totalRequests: data.totalRequests ?? 0,
          totalTokens: (data.totalPromptTokens ?? 0) + (data.totalCompletionTokens ?? 0),
          totalCost: data.totalCost ?? 0,
          byAccount,
        };
      },
      { ...EMPTY_USAGE },
    );
  }

  async getKeys(): Promise<NineRouterKey[]> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/keys`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { keys?: NineRouterKey[] };
      return data.keys ?? [];
    }, []);
  }

  async createKey(name: string): Promise<NineRouterKey | null> {
    return this.breaker.execute<NineRouterKey | null>(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as NineRouterKey;
    }, null);
  }

  async deleteKey(id: string): Promise<boolean> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/keys/${id}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    }, false);
  }

  async getModels(): Promise<NineRouterModel[]> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/models`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { models?: NineRouterModel[] };
      return data.models ?? [];
    }, []);
  }

  async testModel(model: string): Promise<NineRouterModelTestResult> {
    return this.breaker.execute(
      async () => {
        const response = await this.fetchFn(`${this.baseUrl}/api/models/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as NineRouterModelTestResult;
      },
      { success: false, latencyMs: 0, provider: "" },
    );
  }

  async getModelAliases(): Promise<Record<string, string>> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/models/alias`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { aliases?: Record<string, string> };
      return data.aliases ?? {};
    }, {});
  }

  async setModelAlias(alias: string, target: string): Promise<boolean> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/models/alias`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias, target }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    }, false);
  }

  async deleteModelAlias(alias: string): Promise<boolean> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/models/alias`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    }, false);
  }

  async getProviders(): Promise<NineRouterProvider[]> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/providers`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { connections?: NineRouterProvider[] };
      return data.connections ?? [];
    }, []);
  }

  async validateProvider(id: string): Promise<NineRouterValidationResult> {
    return this.breaker.execute(
      async () => {
        const response = await this.fetchFn(`${this.baseUrl}/api/providers/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as NineRouterValidationResult;
      },
      { valid: false, models: 0, latencyMs: 0 },
    );
  }

  async getSettings(): Promise<Record<string, unknown> | null> {
    return this.breaker.execute<Record<string, unknown> | null>(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/settings`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as Record<string, unknown>;
    }, null);
  }

  async updateSettings(patch: Record<string, unknown>): Promise<boolean> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    }, false);
  }

  async getCombos(): Promise<NineRouterCombo[]> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/combos`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { combos?: NineRouterCombo[] };
      return data.combos ?? [];
    }, []);
  }

  async createCombo(combo: { name: string; models: string[] }): Promise<NineRouterCombo | null> {
    return this.breaker.execute<NineRouterCombo | null>(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/combos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(combo),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as NineRouterCombo;
    }, null);
  }

  async deleteCombo(id: string): Promise<boolean> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/combos/${id}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    }, false);
  }

  async getPricing(): Promise<Record<string, unknown>> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/pricing`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as Record<string, unknown>;
    }, {});
  }

  async importOAuthToken(provider: string): Promise<NineRouterOAuthImportResult> {
    return this.breaker.execute(
      async () => {
        const response = await this.fetchFn(`${this.baseUrl}/api/oauth/${provider}/auto-import`, {
          method: "POST",
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as NineRouterOAuthImportResult;
      },
      { success: false },
    );
  }

  async getCliToolSettings(tool: string): Promise<NineRouterCliToolSettings | null> {
    return this.breaker.execute<NineRouterCliToolSettings | null>(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/cli-tools/${tool}-settings`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as NineRouterCliToolSettings;
    }, null);
  }

  async updateCliToolSettings(tool: string, patch: Record<string, unknown>): Promise<boolean> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`${this.baseUrl}/api/cli-tools/${tool}-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    }, false);
  }

  async getStatus(): Promise<NineRouterStatus> {
    const [health, accounts, usage] = await Promise.all([
      this.checkHealth(),
      this.getAccounts(),
      this.getUsage(),
    ]);
    return {
      reachable: health.reachable,
      accounts,
      usage,
    };
  }
}
