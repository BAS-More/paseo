type FetchFn = typeof globalThis.fetch;

export type ServiceStatus = "running" | "stopped" | "error";

export interface ServiceDefinition {
  id: string;
  name: string;
  port: number;
  healthUrl: string;
}

export interface ServiceCheckResult {
  id: string;
  name: string;
  port: number;
  status: ServiceStatus;
  latencyMs?: number;
  error?: string;
}

export interface StackServiceMonitorOptions {
  services?: ServiceDefinition[];
  _fetchForTest?: FetchFn;
}

const DEFAULT_SERVICES: ServiceDefinition[] = [
  {
    id: "nine-router",
    name: "9Router",
    port: 20128,
    healthUrl: "http://localhost:20128/api/init",
  },
  {
    id: "crewai-bridge",
    name: "CrewAI Bridge",
    port: 8000,
    healthUrl: "http://localhost:8000/health",
  },
  {
    id: "soifer-backend",
    name: "Soifer Backend",
    port: 3001,
    healthUrl: "http://localhost:3001/api/stack-health",
  },
];

export class StackServiceMonitor {
  private readonly services: ServiceDefinition[];
  private readonly fetchFn: FetchFn;

  constructor(options: StackServiceMonitorOptions = {}) {
    this.services = options.services ?? DEFAULT_SERVICES;
    this.fetchFn = options._fetchForTest ?? globalThis.fetch;
  }

  getServiceDefinitions(): ServiceDefinition[] {
    return this.services;
  }

  async checkService(serviceId: string): Promise<ServiceCheckResult> {
    const service = this.services.find((s) => s.id === serviceId);
    if (!service) {
      return {
        id: serviceId,
        name: serviceId,
        port: 0,
        status: "error",
        error: `Service "${serviceId}" not found`,
      };
    }

    try {
      const start = Date.now();
      const response = await this.fetchFn(service.healthUrl, {
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - start;

      if (response.ok) {
        return {
          id: service.id,
          name: service.name,
          port: service.port,
          status: "running",
          latencyMs,
        };
      }
      return {
        id: service.id,
        name: service.name,
        port: service.port,
        status: "stopped",
      };
    } catch {
      return {
        id: service.id,
        name: service.name,
        port: service.port,
        status: "stopped",
      };
    }
  }

  async checkAll(): Promise<ServiceCheckResult[]> {
    return Promise.all(this.services.map((s) => this.checkService(s.id)));
  }
}
