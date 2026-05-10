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
