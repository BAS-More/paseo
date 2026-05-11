import type { ChildProcess } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";

import { CircuitBreaker } from "./agent/circuit-breaker.js";

type SpawnFn = typeof nodeSpawn;
type FetchFn = typeof globalThis.fetch;

export type BridgeStatus = "stopped" | "starting" | "running" | "error";

export interface CrewAiBridgeManagerOptions {
  bridgePath: string;
  pythonPath?: string;
  port?: number;
  _spawnForTest?: SpawnFn;
  _fetchForTest?: FetchFn;
  _breakerForTest?: CircuitBreaker;
  /** Max consecutive crashes within `crashWindowMs` before giving up. Default 5. */
  maxCrashRestarts?: number;
  /** Rolling crash-count window. Default 5 minutes. */
  crashWindowMs?: number;
}

const DEFAULT_MAX_RESTARTS = 5;
const DEFAULT_CRASH_WINDOW_MS = 5 * 60 * 1000;
const RESTART_BACKOFF_CAP_MS = 60_000;

export class CrewAiBridgeManager {
  private readonly bridgePath: string;
  private readonly pythonPath: string;
  private readonly port: number;
  private readonly spawnFn: SpawnFn;
  private readonly fetchFn: FetchFn;
  private readonly breaker: CircuitBreaker;
  private readonly maxCrashRestarts: number;
  private readonly crashWindowMs: number;
  private process: ChildProcess | null = null;
  private status: BridgeStatus = "stopped";
  // H-11: crash-loop tracking
  private intentionalStop = false;
  private restartCount = 0;
  private restartWindowStart = 0;
  private restartTimer: NodeJS.Timeout | null = null;

  constructor(options: CrewAiBridgeManagerOptions) {
    this.bridgePath = options.bridgePath;
    this.pythonPath = options.pythonPath ?? "python";
    this.port = options.port ?? 8000;
    this.spawnFn = (options._spawnForTest as SpawnFn) ?? nodeSpawn;
    this.fetchFn = options._fetchForTest ?? globalThis.fetch;
    this.breaker = options._breakerForTest ?? new CircuitBreaker();
    this.maxCrashRestarts = options.maxCrashRestarts ?? DEFAULT_MAX_RESTARTS;
    this.crashWindowMs = options.crashWindowMs ?? DEFAULT_CRASH_WINDOW_MS;
  }

  getPort(): number {
    return this.port;
  }

  getStatus(): BridgeStatus {
    return this.status;
  }

  getBreakerState(): "closed" | "open" | "half-open" {
    return this.breaker.state;
  }

  /** Diagnostic: number of unexpected restarts within the current crash window. */
  getRestartCount(): number {
    return this.restartCount;
  }

  async isRunning(): Promise<boolean> {
    return this.breaker.execute(async () => {
      const response = await this.fetchFn(`http://localhost:${this.port}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    }, false);
  }

  async start(): Promise<void> {
    this.intentionalStop = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

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

    // H-11: detect unexpected exits and auto-restart with exponential backoff.
    proc.once("exit", (code, signal) => {
      this.handleExit(code, signal);
    });
    proc.once("error", () => {
      // Spawn failure — treat as immediate crash.
      this.handleExit(1, null);
    });

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
    this.intentionalStop = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
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

  private handleExit(_code: number | null, _signal: NodeJS.Signals | null): void {
    if (this.intentionalStop) {
      // Operator-initiated stop — do not auto-restart.
      return;
    }

    const now = Date.now();
    if (now - this.restartWindowStart > this.crashWindowMs) {
      // Outside the rolling window; reset the counter.
      this.restartWindowStart = now;
      this.restartCount = 0;
    }
    this.restartCount += 1;

    if (this.restartCount > this.maxCrashRestarts) {
      this.status = "error";
      this.process = null;
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 60s.
    const backoffMs = Math.min(RESTART_BACKOFF_CAP_MS, 1000 * 2 ** (this.restartCount - 1));
    this.status = "starting";
    this.process = null;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start();
    }, backoffMs);
    // Don't keep the event loop alive for the retry timer.
    if (typeof this.restartTimer.unref === "function") {
      this.restartTimer.unref();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
