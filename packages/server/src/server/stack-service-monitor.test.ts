import { describe, expect, it, vi } from "vitest";
import { StackServiceMonitor } from "./stack-service-monitor.js";
import {
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  StackServicesRequestSchema,
  StackServicesResponseSchema,
} from "../shared/messages.js";

function createMockFetch(healthyPorts: Set<number> = new Set()) {
  return vi.fn(async (url: string) => {
    const port = Number(new URL(url).port);
    if (healthyPorts.has(port)) {
      return { ok: true } as Response;
    }
    throw new Error("ECONNREFUSED");
  });
}

describe("StackServiceMonitor", () => {
  let monitor: StackServiceMonitor;

  describe("construction", () => {
    it("creates with default service definitions", () => {
      monitor = new StackServiceMonitor({ _fetchForTest: createMockFetch() });
      expect(monitor).toBeDefined();
    });

    it("exposes service list", () => {
      monitor = new StackServiceMonitor({ _fetchForTest: createMockFetch() });
      const services = monitor.getServiceDefinitions();
      expect(services.length).toBeGreaterThan(0);
      expect(services[0]).toHaveProperty("id");
      expect(services[0]).toHaveProperty("name");
      expect(services[0]).toHaveProperty("port");
      expect(services[0]).toHaveProperty("healthUrl");
    });
  });

  describe("checkService()", () => {
    it("returns healthy for reachable service", async () => {
      monitor = new StackServiceMonitor({
        _fetchForTest: createMockFetch(new Set([20128])),
      });
      const result = await monitor.checkService("nine-router");
      expect(result.status).toBe("running");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns stopped for unreachable service", async () => {
      monitor = new StackServiceMonitor({
        _fetchForTest: createMockFetch(new Set()),
      });
      const result = await monitor.checkService("nine-router");
      expect(result.status).toBe("stopped");
    });

    it("returns error for unknown service id", async () => {
      monitor = new StackServiceMonitor({
        _fetchForTest: createMockFetch(),
      });
      const result = await monitor.checkService("nonexistent");
      expect(result.status).toBe("error");
      expect(result.error).toContain("not found");
    });
  });

  describe("checkAll()", () => {
    it("checks all services in parallel", async () => {
      const healthyPorts = new Set([20128, 8000]);
      monitor = new StackServiceMonitor({
        _fetchForTest: createMockFetch(healthyPorts),
      });
      const results = await monitor.checkAll();
      expect(results.length).toBeGreaterThan(0);

      const nineRouter = results[0];
      const crewai = results[1];
      expect(nineRouter?.id).toBe("nine-router");
      expect(nineRouter?.status).toBe("running");
      expect(crewai?.id).toBe("crewai-bridge");
      expect(crewai?.status).toBe("running");
    });

    it("marks unreachable services as stopped", async () => {
      monitor = new StackServiceMonitor({
        _fetchForTest: createMockFetch(new Set()),
      });
      const results = await monitor.checkAll();
      for (const result of results) {
        expect(result.status).toBe("stopped");
      }
    });
  });

  describe("message schemas", () => {
    it("StackServicesRequestSchema validates", () => {
      const result = StackServicesRequestSchema.safeParse({
        type: "stack_services_request",
        requestId: "req-1",
      });
      expect(result.success).toBe(true);
    });

    it("request is in SessionInboundMessageSchema", () => {
      const result = SessionInboundMessageSchema.safeParse({
        type: "stack_services_request",
        requestId: "req-1",
      });
      expect(result.success).toBe(true);
    });

    it("StackServicesResponseSchema validates", () => {
      const result = StackServicesResponseSchema.safeParse({
        type: "stack_services_response",
        payload: {
          requestId: "req-1",
          services: [
            { id: "nine-router", name: "9Router", port: 20128, status: "running", latencyMs: 5 },
            { id: "crewai-bridge", name: "CrewAI Bridge", port: 8000, status: "stopped" },
          ],
        },
      });
      expect(result.success).toBe(true);
    });

    it("response is in SessionOutboundMessageSchema", () => {
      const result = SessionOutboundMessageSchema.safeParse({
        type: "stack_services_response",
        payload: {
          requestId: "req-1",
          services: [{ id: "test", name: "Test", port: 3000, status: "running" }],
        },
      });
      expect(result.success).toBe(true);
    });
  });
});
