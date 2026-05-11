import type { RequestHandler } from "express";

/**
 * Tracks daemon lifecycle for k8s-compatible health probes.
 *
 * Lifecycle:  created → bootstrapped → listening
 *
 * - `/health/live`    — 200 if the process is alive (always true once registered)
 * - `/health/ready`   — 200 if bootstrap is complete AND the HTTP server is listening
 * - `/health/startup` — 200 once bootstrap has finished (server may not be listening yet)
 */
export interface HealthState {
  /** Set to true after bootstrap() services have initialized. */
  bootstrapped: boolean;
  /** Set to true after httpServer.listen() resolves. */
  listening: boolean;
}

/** Result returned by an individual dependency check function. */
export interface DependencyCheckResult {
  name: string;
  ok: boolean;
  error?: string;
}

/** An async function that tests one runtime dependency. */
export type DependencyCheck = () => Promise<DependencyCheckResult>;

export interface ReadinessHandlerOptions {
  /**
   * Optional list of async dependency checks. Each function returns a
   * `DependencyCheckResult`. If any check returns `ok: false`, the handler
   * responds 503 and includes the failing checks in the body.
   */
  dependencyChecks?: DependencyCheck[];
}

export function createHealthState(): HealthState {
  return { bootstrapped: false, listening: false };
}

export function createLivenessHandler(): RequestHandler {
  return (_req, res) => {
    res.json({ status: "ok" });
  };
}

export function createReadinessHandler(
  state: HealthState,
  options?: ReadinessHandlerOptions,
): RequestHandler {
  return async (_req, res) => {
    if (!state.bootstrapped || !state.listening) {
      res.status(503).json({
        status: "unavailable",
        bootstrapped: state.bootstrapped,
        listening: state.listening,
      });
      return;
    }

    const checks = options?.dependencyChecks ?? [];
    if (checks.length > 0) {
      const results = await Promise.all(checks.map((check) => check()));
      const failedChecks = results.filter((r) => !r.ok);
      if (failedChecks.length > 0) {
        res.status(503).json({
          status: "unavailable",
          failedChecks,
        });
        return;
      }
    }

    res.json({ status: "ok" });
  };
}

export function createStartupHandler(state: HealthState): RequestHandler {
  return (_req, res) => {
    if (state.bootstrapped) {
      res.json({ status: "ok" });
    } else {
      res.status(503).json({ status: "starting" });
    }
  };
}
