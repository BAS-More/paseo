import { describe, expect, it } from "vitest";

import {
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  NineRouterStatusRequestSchema,
  NineRouterStatusResponseSchema,
} from "../shared/messages.js";

describe("9Router message schemas", () => {
  describe("NineRouterStatusRequest", () => {
    it("validates a well-formed request", () => {
      const msg = { type: "nine_router_status_request", requestId: "req-123" };
      const result = NineRouterStatusRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("rejects request without requestId", () => {
      const msg = { type: "nine_router_status_request" };
      const result = NineRouterStatusRequestSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("is included in SessionInboundMessageSchema", () => {
      const msg = { type: "nine_router_status_request", requestId: "req-456" };
      const result = SessionInboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterStatusResponse", () => {
    const validResponse = {
      type: "nine_router_status_response",
      payload: {
        requestId: "req-123",
        reachable: true,
        accounts: [{ id: "acc-1", name: "GPT-4", provider: "openai", status: "active" }],
        usage: {
          totalRequests: 100,
          totalTokens: 50000,
          totalCost: 1.5,
          byAccount: [{ id: "acc-1", requests: 100, tokens: 50000, cost: 1.5 }],
        },
      },
    };

    it("validates a well-formed response", () => {
      const result = NineRouterStatusResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it("validates unreachable response with empty data", () => {
      const msg = {
        type: "nine_router_status_response",
        payload: {
          requestId: "req-789",
          reachable: false,
          accounts: [],
          usage: { totalRequests: 0, totalTokens: 0, totalCost: 0, byAccount: [] },
        },
      };
      const result = NineRouterStatusResponseSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("is included in SessionOutboundMessageSchema", () => {
      const result = SessionOutboundMessageSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it("rejects response without payload", () => {
      const msg = { type: "nine_router_status_response" };
      const result = NineRouterStatusResponseSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("rejects response with missing payload fields", () => {
      const msg = {
        type: "nine_router_status_response",
        payload: { requestId: "req-123", reachable: true },
      };
      const result = NineRouterStatusResponseSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe("request-response correlation", () => {
    it("response payload contains requestId for correlation", () => {
      const requestId = "corr-test-001";
      const request = NineRouterStatusRequestSchema.parse({
        type: "nine_router_status_request",
        requestId,
      });
      const response = NineRouterStatusResponseSchema.parse({
        type: "nine_router_status_response",
        payload: {
          requestId,
          reachable: true,
          accounts: [],
          usage: { totalRequests: 0, totalTokens: 0, totalCost: 0, byAccount: [] },
        },
      });
      expect(response.payload.requestId).toBe(request.requestId);
    });
  });
});
