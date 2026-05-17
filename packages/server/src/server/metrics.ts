/**
 * Prometheus metrics for the Paseo daemon.
 *
 * Requires `prom-client` to be installed (`npm i prom-client` in packages/server).
 * When prom-client is missing, all metric operations silently no-op and the
 * /metrics endpoint returns 501 — the daemon starts normally without it.
 */
import type { RequestHandler } from "express";

// Metric handle interfaces — decoupled from prom-client types so consumers
// work regardless of whether the package is installed.
interface GaugeHandle {
  set(value: number): void;
  inc(labels?: Record<string, string>): void;
  dec(labels?: Record<string, string>): void;
}

interface CounterHandle {
  inc(labels?: Record<string, string>): void;
}

interface HistogramHandle {
  observe(value: number): void;
  startTimer(): (labels?: Record<string, string>) => void;
}

export interface PaseoMetrics {
  wsConnectionsActive: GaugeHandle;
  agentsActive: GaugeHandle;
  httpRequestsTotal: CounterHandle;
  httpRequestDurationSeconds: HistogramHandle;
  backupLastSuccessTimestamp: GaugeHandle;
  agentErrorsTotal: CounterHandle;
}

// Lazy-loaded prom-client bindings. Populated by `initPromClient()`.
let promGauge: (new (opts: Record<string, unknown>) => GaugeHandle) | null = null;
let promCounter: (new (opts: Record<string, unknown>) => CounterHandle) | null = null;
let promHistogram: (new (opts: Record<string, unknown>) => HistogramHandle) | null = null;
let promRegister: { metrics(): Promise<string>; contentType: string } | null = null;
let promInitialized = false;

async function initPromClient(): Promise<boolean> {
  if (promInitialized) return promRegister !== null;
  promInitialized = true;
  try {
    // @ts-expect-error — prom-client is an optional dependency
    const mod = await import("prom-client");
    promGauge = mod.Gauge as unknown as typeof promGauge;
    promCounter = mod.Counter as unknown as typeof promCounter;
    promHistogram = mod.Histogram as unknown as typeof promHistogram;
    promRegister = mod.register;
    return true;
  } catch {
    return false;
  }
}

// No-op stubs when prom-client is unavailable.
const noopGauge: GaugeHandle = { set() {}, inc() {}, dec() {} };
const noopCounter: CounterHandle = { inc() {} };
const noopHistogram: HistogramHandle = { observe() {}, startTimer: () => () => {} };

function makeGauge(opts: Record<string, unknown>): GaugeHandle {
  if (!promGauge) return noopGauge;
  return new promGauge(opts);
}
function makeCounter(opts: Record<string, unknown>): CounterHandle {
  if (!promCounter) return noopCounter;
  return new promCounter(opts);
}
function makeHistogram(opts: Record<string, unknown>): HistogramHandle {
  if (!promHistogram) return noopHistogram;
  return new promHistogram(opts);
}

export function createMetrics(): PaseoMetrics {
  // Kick off async init — metrics created before it resolves use no-op stubs.
  // Bootstrap calls `ensureMetricsReady()` before the server starts listening
  // so by the time traffic arrives the real metrics are wired.
  void initPromClient();

  return {
    wsConnectionsActive: makeGauge({
      name: "ws_connections_active",
      help: "Number of active WebSocket connections",
    }),
    agentsActive: makeGauge({
      name: "agents_active",
      help: "Number of currently running agents",
    }),
    httpRequestsTotal: makeCounter({
      name: "http_requests_total",
      help: "Total HTTP requests",
      labelNames: ["method", "path", "status"],
    }),
    httpRequestDurationSeconds: makeHistogram({
      name: "http_request_duration_seconds",
      help: "HTTP request latency in seconds",
      labelNames: ["method", "path", "status"],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    }),
    backupLastSuccessTimestamp: makeGauge({
      name: "backup_last_success_timestamp",
      help: "Unix epoch of last successful backup",
    }),
    agentErrorsTotal: makeCounter({
      name: "agent_errors_total",
      help: "Total agent errors by provider",
      labelNames: ["provider"],
    }),
  };
}

/**
 * Await this once during bootstrap to guarantee prom-client is loaded
 * (or confirmed missing) before the server accepts traffic.
 */
export async function ensureMetricsReady(): Promise<boolean> {
  return initPromClient();
}

// Collapse high-cardinality path segments to `:id` so label sets stay bounded.
// Matches: UUIDs, hex hashes (8+ chars), pure-numeric segments, and
// mnemonic-style IDs like "abc-123-def" (contains a digit + hyphen).
const ID_SEGMENT_RE = /\/[0-9a-f]{8,}(?:-[0-9a-f]{4,}){0,4}\b/gi;
const PURE_NUMERIC_SEGMENT_RE = /\/\d+(?=\/|$)/g;
const MNEMONIC_ID_RE = /\/[a-z0-9]+-[a-z0-9]+-[a-z0-9]+(?=\/|$)/gi;

function normalizePath(raw: string): string {
  return raw
    .replace(ID_SEGMENT_RE, "/:id")
    .replace(MNEMONIC_ID_RE, "/:id")
    .replace(PURE_NUMERIC_SEGMENT_RE, "/:id");
}

export function createMetricsMiddleware(metrics: PaseoMetrics): RequestHandler {
  return (req, res, next) => {
    const endTimer = metrics.httpRequestDurationSeconds.startTimer();

    res.on("finish", () => {
      const labels = {
        method: req.method,
        path: normalizePath(req.path),
        status: String(res.statusCode),
      };
      metrics.httpRequestsTotal.inc(labels);
      endTimer(labels);
    });

    next();
  };
}

export function createMetricsHandler(): RequestHandler {
  return async (_req, res) => {
    if (!promRegister) {
      res.status(501).json({ error: "prom-client not installed" });
      return;
    }
    try {
      const output = await promRegister.metrics();
      res.set("Content-Type", promRegister.contentType);
      res.end(output);
    } catch {
      res.status(500).end();
    }
  };
}
