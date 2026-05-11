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

export function createHealthState(): HealthState {
  return { bootstrapped: false, listening: false };
}

export function createLivenessHandler(): RequestHandler {
  return (_req, res) => {
    res.json({ status: "ok" });
  };
}

export function createReadinessHandler(state: HealthState): RequestHandler {
  return (_req, res) => {
    if (state.bootstrapped && state.listening) {
      res.json({ status: "ok" });
    } else {
      res.status(503).json({
        status: "unavailable",
        bootstrapped: state.bootstrapped,
        listening: state.listening,
      });
    }
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
