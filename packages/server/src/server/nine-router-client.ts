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

  constructor(options?: NineRouterClientOptions) {
    this.baseUrl = options?.baseUrl ?? process.env.NINE_ROUTER_URL ?? "http://localhost:20128";
    this.fetchFn = options?._fetchForTest ?? globalThis.fetch;
  }

  async checkHealth(): Promise<{ reachable: boolean }> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/init`, {
        signal: AbortSignal.timeout(3000),
      });
      return { reachable: response.ok };
    } catch {
      return { reachable: false };
    }
  }

  async getAccounts(): Promise<NineRouterAccount[]> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/providers/client`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { connections: NineRouterAccount[] };
      return data.connections ?? [];
    } catch {
      return [];
    }
  }

  async getUsage(options?: { period?: string }): Promise<NineRouterUsage> {
    try {
      const url = options?.period
        ? `${this.baseUrl}/api/usage/stats?period=${options.period}`
        : `${this.baseUrl}/api/usage/stats`;
      const response = await this.fetchFn(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return { ...EMPTY_USAGE };
      const data = (await response.json()) as {
        totalRequests?: number;
        totalPromptTokens?: number;
        totalCompletionTokens?: number;
        totalCost?: number;
        byAccount?: Record<string, { requests?: number; tokens?: number; cost?: number }>;
      };
      // Map 9Router shape to NineRouterUsage interface
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
    } catch {
      return { ...EMPTY_USAGE };
    }
  }

  async getKeys(): Promise<NineRouterKey[]> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/keys`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { keys?: NineRouterKey[] };
      return data.keys ?? [];
    } catch {
      return [];
    }
  }

  async createKey(name: string): Promise<NineRouterKey | null> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      return (await response.json()) as NineRouterKey;
    } catch {
      return null;
    }
  }

  async deleteKey(id: string): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/keys/${id}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<NineRouterModel[]> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/models`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { models?: NineRouterModel[] };
      return data.models ?? [];
    } catch {
      return [];
    }
  }

  async testModel(model: string): Promise<NineRouterModelTestResult> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/models/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) return { success: false, latencyMs: 0, provider: "" };
      return (await response.json()) as NineRouterModelTestResult;
    } catch {
      return { success: false, latencyMs: 0, provider: "" };
    }
  }

  async getModelAliases(): Promise<Record<string, string>> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/models/alias`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return {};
      const data = (await response.json()) as { aliases?: Record<string, string> };
      return data.aliases ?? {};
    } catch {
      return {};
    }
  }

  async setModelAlias(alias: string, target: string): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/models/alias`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias, target }),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getProviders(): Promise<NineRouterProvider[]> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/providers`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { connections?: NineRouterProvider[] };
      return data.connections ?? [];
    } catch {
      return [];
    }
  }

  async validateProvider(id: string): Promise<NineRouterValidationResult> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/providers/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return { valid: false, models: 0, latencyMs: 0 };
      return (await response.json()) as NineRouterValidationResult;
    } catch {
      return { valid: false, models: 0, latencyMs: 0 };
    }
  }

  async getSettings(): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/settings`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async updateSettings(patch: Record<string, unknown>): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getCombos(): Promise<NineRouterCombo[]> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/combos`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { combos?: NineRouterCombo[] };
      return data.combos ?? [];
    } catch {
      return [];
    }
  }

  async createCombo(combo: { name: string; models: string[] }): Promise<NineRouterCombo | null> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/combos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(combo),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      return (await response.json()) as NineRouterCombo;
    } catch {
      return null;
    }
  }

  async deleteCombo(id: string): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/combos/${id}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getPricing(): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/pricing`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return {};
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async importOAuthToken(provider: string): Promise<NineRouterOAuthImportResult> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/oauth/${provider}/auto-import`, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return { success: false };
      return (await response.json()) as NineRouterOAuthImportResult;
    } catch {
      return { success: false };
    }
  }

  async getCliToolSettings(tool: string): Promise<NineRouterCliToolSettings | null> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/cli-tools/${tool}-settings`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      return (await response.json()) as NineRouterCliToolSettings;
    } catch {
      return null;
    }
  }

  async updateCliToolSettings(tool: string, patch: Record<string, unknown>): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/cli-tools/${tool}-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
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
