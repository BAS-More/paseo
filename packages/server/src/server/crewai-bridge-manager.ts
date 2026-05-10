import type { ChildProcess } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";

type SpawnFn = typeof nodeSpawn;
type FetchFn = typeof globalThis.fetch;

export type BridgeStatus = "stopped" | "starting" | "running" | "error";

export interface CrewAiBridgeManagerOptions {
  bridgePath: string;
  pythonPath?: string;
  port?: number;
  _spawnForTest?: SpawnFn;
  _fetchForTest?: FetchFn;
}

export class CrewAiBridgeManager {
  private readonly bridgePath: string;
  private readonly pythonPath: string;
  private readonly port: number;
  private readonly spawnFn: SpawnFn;
  private readonly fetchFn: FetchFn;
  private process: ChildProcess | null = null;
  private status: BridgeStatus = "stopped";

  constructor(options: CrewAiBridgeManagerOptions) {
    this.bridgePath = options.bridgePath;
    this.pythonPath = options.pythonPath ?? "python";
    this.port = options.port ?? 8000;
    this.spawnFn = (options._spawnForTest as SpawnFn) ?? nodeSpawn;
    this.fetchFn = options._fetchForTest ?? globalThis.fetch;
  }

  getPort(): number {
    return this.port;
  }

  getStatus(): BridgeStatus {
    return this.status;
  }

  async isRunning(): Promise<boolean> {
    try {
      const response = await this.fetchFn(`http://localhost:${this.port}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    // Skip if already running
    if (this.status === "running") {
      const healthy = await this.isRunning();
      if (healthy) return;
    }

    this.status = "starting";

    const proc = this.spawnFn(this.pythonPath, [this.bridgePath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: String(this.port) },
      detached: false,
    });

    this.process = proc as unknown as ChildProcess;

    // Wait for health check with retries
    const maxAttempts = 10;
    const delayMs = 500;

    for (let i = 0; i < maxAttempts; i++) {
      await this.delay(delayMs);
      const healthy = await this.isRunning();
      if (healthy) {
        this.status = "running";
        return;
      }
    }

    this.status = "error";
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.status = "stopped";
  }

  async restart(): Promise<void> {
    this.stop();
    await this.start();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
