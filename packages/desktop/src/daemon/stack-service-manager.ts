import { type ChildProcess, spawn } from "node:child_process";
import log from "electron-log/main";
import { ipcMain } from "electron";
import http from "node:http";

// External services the Electron app manages alongside the Paseo daemon.
// OCC is a CLI tool (spawned per-session), not a persistent service.

export interface StackService {
  name: string;
  port: number;
  healthUrl: string;
  command: string;
  args: string[];
  cwd: string;
  shell: boolean;
  /** Env overlay applied on top of process.env */
  env?: Record<string, string>;
}

interface ManagedService {
  config: StackService;
  process: ChildProcess | null;
  status: "stopped" | "starting" | "running" | "errored";
  error: string | null;
  managedByDesktop: boolean;
}

const SERVICES: StackService[] = [
  {
    name: "9Router",
    port: 20128,
    healthUrl: "http://127.0.0.1:20128/v1/models",
    command: "npm",
    args: ["run", "dev"],
    cwd: "C:/Dev/tools/9router",
    shell: true,
  },
  {
    name: "Soifer Backend",
    port: 3001,
    healthUrl: "http://127.0.0.1:3001/api/stack-health",
    command: "npm",
    args: ["run", "dev"],
    cwd: "C:/Dev/tools/claudecodeui",
    shell: true,
  },
  {
    name: "CrewAI Bridge",
    port: 8000,
    healthUrl: "http://127.0.0.1:8000/health",
    command: "C:/Dev/tools/CrewAI-Studio/venv/Scripts/python.exe",
    args: ["bridge/api.py"],
    cwd: "C:/Dev/tools/CrewAI-Studio",
    shell: false,
    env: { CREWAI_TRACING_ENABLED: "false" },
  },
];

const managed = new Map<string, ManagedService>();

function httpHealthCheck(url: string, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function isServiceRunning(svc: StackService): Promise<boolean> {
  return httpHealthCheck(svc.healthUrl);
}

function spawnService(svc: StackService): ChildProcess {
  const env = { ...process.env, ...svc.env };
  const child = spawn(svc.command, svc.args, {
    cwd: svc.cwd,
    env,
    shell: svc.shell,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.unref();
  return child;
}

async function waitForHealthy(
  svc: StackService,
  maxAttempts = 30,
  intervalMs = 1000,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isServiceRunning(svc)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function ensureServiceRunning(svc: StackService): Promise<ManagedService> {
  const existing = managed.get(svc.name);

  // Already running externally or by us
  if (await isServiceRunning(svc)) {
    const entry: ManagedService = existing ?? {
      config: svc,
      process: null,
      status: "running",
      error: null,
      managedByDesktop: false,
    };
    entry.status = "running";
    entry.error = null;
    if (!existing) entry.managedByDesktop = false;
    managed.set(svc.name, entry);
    log.info(`[stack] ${svc.name} already running on :${svc.port}`);
    return entry;
  }

  // Need to start it
  log.info(`[stack] Starting ${svc.name} (${svc.command} ${svc.args.join(" ")}) in ${svc.cwd}`);
  const entry: ManagedService = {
    config: svc,
    process: null,
    status: "starting",
    error: null,
    managedByDesktop: true,
  };
  managed.set(svc.name, entry);

  try {
    const child = spawnService(svc);
    entry.process = child;

    child.stdout?.on("data", (data: Buffer) => {
      log.info(`[stack:${svc.name}] ${data.toString().trimEnd()}`);
    });
    child.stderr?.on("data", (data: Buffer) => {
      log.warn(`[stack:${svc.name}:err] ${data.toString().trimEnd()}`);
    });
    child.on("exit", (code) => {
      log.info(`[stack] ${svc.name} exited with code ${code}`);
      entry.status = code === 0 ? "stopped" : "errored";
      entry.error = code !== 0 ? `Process exited with code ${code}` : null;
      entry.process = null;
    });

    const healthy = await waitForHealthy(svc);
    if (healthy) {
      entry.status = "running";
      log.info(`[stack] ${svc.name} is healthy on :${svc.port}`);
    } else {
      entry.status = "errored";
      entry.error = `Failed to become healthy within timeout`;
      log.error(`[stack] ${svc.name} failed health check after startup`);
    }
  } catch (err) {
    entry.status = "errored";
    entry.error = err instanceof Error ? err.message : String(err);
    log.error(`[stack] Failed to start ${svc.name}:`, entry.error);
  }

  return entry;
}

function stopManagedService(entry: ManagedService): void {
  if (!entry.process || !entry.managedByDesktop) return;
  log.info(`[stack] Stopping ${entry.config.name} (pid ${entry.process.pid})`);
  try {
    // On Windows, detached processes need taskkill for the tree
    if (process.platform === "win32" && entry.process.pid) {
      spawn("taskkill", ["/pid", String(entry.process.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      entry.process.kill("SIGTERM");
    }
  } catch (err) {
    log.warn(`[stack] Error stopping ${entry.config.name}:`, err);
  }
  entry.process = null;
  entry.status = "stopped";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startStackServices(): Promise<void> {
  log.info("[stack] Starting external stack services...");
  const results = await Promise.allSettled(SERVICES.map((svc) => ensureServiceRunning(svc)));
  for (const [i, result] of results.entries()) {
    if (result.status === "rejected") {
      log.error(`[stack] ${SERVICES[i].name} failed:`, result.reason);
    }
  }
  const summary = SERVICES.map((svc) => {
    const m = managed.get(svc.name);
    return `${svc.name} :${svc.port} ${m?.status ?? "unknown"}${m?.managedByDesktop ? " (desktop-managed)" : ""}`;
  });
  log.info(`[stack] Service status:\n  ${summary.join("\n  ")}`);
}

export function stopStackServices(): void {
  log.info("[stack] Stopping desktop-managed stack services...");
  for (const entry of managed.values()) {
    stopManagedService(entry);
  }
}

export async function getStackStatus(): Promise<
  Array<{
    name: string;
    port: number;
    status: string;
    managedByDesktop: boolean;
    error: string | null;
  }>
> {
  const statuses = [];
  for (const svc of SERVICES) {
    const m = managed.get(svc.name);
    const running = await isServiceRunning(svc);
    statuses.push({
      name: svc.name,
      port: svc.port,
      status: running ? "running" : (m?.status ?? "stopped"),
      managedByDesktop: m?.managedByDesktop ?? false,
      error: m?.error ?? null,
    });
  }
  return statuses;
}

export function registerStackServiceManager(): void {
  ipcMain.handle("stack:status", async () => getStackStatus());
  ipcMain.handle("stack:start", async () => {
    await startStackServices();
    return getStackStatus();
  });
  ipcMain.handle("stack:stop", () => {
    stopStackServices();
    return { stopped: true };
  });
}
