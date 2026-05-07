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
      const response = await this.fetchFn(`${this.baseUrl}/api/connections`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { connections: NineRouterAccount[] };
      return data.connections;
    } catch {
      return [];
    }
  }

  async getUsage(options?: { period?: string }): Promise<NineRouterUsage> {
    try {
      const url = options?.period
        ? `${this.baseUrl}/api/usage?period=${options.period}`
        : `${this.baseUrl}/api/usage`;
      const response = await this.fetchFn(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return { ...EMPTY_USAGE };
      return (await response.json()) as NineRouterUsage;
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
