import { describe, expect, it } from "vitest";

import {
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  NineRouterStatusRequestSchema,
  NineRouterStatusResponseSchema,
  NineRouterKeysRequestSchema,
  NineRouterKeysResponseSchema,
  NineRouterCreateKeyRequestSchema,
  NineRouterDeleteKeyRequestSchema,
  NineRouterModelsRequestSchema,
  NineRouterModelsResponseSchema,
  NineRouterProvidersRequestSchema,
  NineRouterProvidersResponseSchema,
  NineRouterUsageRequestSchema,
  NineRouterUsageResponseSchema,
  NineRouterOAuthImportRequestSchema,
  NineRouterOAuthImportResponseSchema,
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

  describe("NineRouterKeysRequest", () => {
    it("validates a well-formed keys request", () => {
      const msg = { type: "nine_router_keys_request", requestId: "req-k1" };
      const result = NineRouterKeysRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("is included in SessionInboundMessageSchema", () => {
      const msg = { type: "nine_router_keys_request", requestId: "req-k2" };
      const result = SessionInboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterKeysResponse", () => {
    it("validates response with key list", () => {
      const msg = {
        type: "nine_router_keys_response",
        payload: {
          requestId: "req-k1",
          keys: [
            {
              id: "k1",
              name: "Claude Code",
              key: "sk-abc",
              machineId: "m1",
              isActive: true,
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
      };
      const result = NineRouterKeysResponseSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("is included in SessionOutboundMessageSchema", () => {
      const msg = {
        type: "nine_router_keys_response",
        payload: { requestId: "req-k1", keys: [] },
      };
      const result = SessionOutboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterCreateKeyRequest", () => {
    it("validates request with name", () => {
      const msg = { type: "nine_router_create_key_request", requestId: "req-ck1", name: "My Key" };
      const result = NineRouterCreateKeyRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("is included in SessionInboundMessageSchema", () => {
      const msg = { type: "nine_router_create_key_request", requestId: "req-ck2", name: "Test" };
      const result = SessionInboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterDeleteKeyRequest", () => {
    it("validates request with key id", () => {
      const msg = { type: "nine_router_delete_key_request", requestId: "req-dk1", keyId: "k1" };
      const result = NineRouterDeleteKeyRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("is included in SessionInboundMessageSchema", () => {
      const msg = { type: "nine_router_delete_key_request", requestId: "req-dk2", keyId: "k2" };
      const result = SessionInboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterModelsRequest", () => {
    it("validates a well-formed models request", () => {
      const msg = { type: "nine_router_models_request", requestId: "req-m1" };
      const result = NineRouterModelsRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("is included in SessionInboundMessageSchema", () => {
      const msg = { type: "nine_router_models_request", requestId: "req-m2" };
      const result = SessionInboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterModelsResponse", () => {
    it("validates response with model list", () => {
      const msg = {
        type: "nine_router_models_response",
        payload: {
          requestId: "req-m1",
          models: [
            {
              provider: "cc",
              model: "claude-sonnet-4-6",
              name: "Claude Sonnet 4.6",
              fullModel: "cc/claude-sonnet-4-6",
              alias: "claude-sonnet-4-6",
            },
          ],
        },
      };
      const result = NineRouterModelsResponseSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("is included in SessionOutboundMessageSchema", () => {
      const msg = {
        type: "nine_router_models_response",
        payload: { requestId: "req-m1", models: [] },
      };
      const result = SessionOutboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterProvidersRequest", () => {
    it("validates a well-formed providers request", () => {
      const msg = { type: "nine_router_providers_request", requestId: "req-p1" };
      const result = NineRouterProvidersRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("is included in SessionInboundMessageSchema", () => {
      const msg = { type: "nine_router_providers_request", requestId: "req-p2" };
      const result = SessionInboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterProvidersResponse", () => {
    it("validates response with provider list", () => {
      const msg = {
        type: "nine_router_providers_response",
        payload: {
          requestId: "req-p1",
          providers: [
            {
              id: "p1",
              provider: "claude",
              authType: "oauth",
              name: "avi770",
              priority: 1,
              isActive: true,
              testStatus: "active",
            },
          ],
        },
      };
      const result = NineRouterProvidersResponseSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("is included in SessionOutboundMessageSchema", () => {
      const msg = {
        type: "nine_router_providers_response",
        payload: { requestId: "req-p1", providers: [] },
      };
      const result = SessionOutboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterUsageRequest", () => {
    it("validates request without period (defaults to all-time)", () => {
      const msg = { type: "nine_router_usage_request", requestId: "req-u1" };
      const result = NineRouterUsageRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("validates request with period", () => {
      const msg = { type: "nine_router_usage_request", requestId: "req-u2", period: "7d" };
      const result = NineRouterUsageRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("is included in SessionInboundMessageSchema", () => {
      const msg = { type: "nine_router_usage_request", requestId: "req-u3", period: "24h" };
      const result = SessionInboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterUsageResponse", () => {
    const validResponse = {
      type: "nine_router_usage_response",
      payload: {
        requestId: "req-u1",
        period: "7d",
        totalRequests: 500,
        totalTokens: 125000,
        totalCost: 3.75,
        byProvider: [
          { provider: "anthropic", requests: 300, tokens: 80000, cost: 2.5 },
          { provider: "openai", requests: 200, tokens: 45000, cost: 1.25 },
        ],
        byModel: [
          { model: "claude-sonnet-4-20250514", requests: 250, tokens: 60000, cost: 1.8 },
          { model: "gpt-4o", requests: 200, tokens: 45000, cost: 1.25 },
        ],
      },
    };

    it("validates a well-formed response", () => {
      const result = NineRouterUsageResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it("validates response with empty arrays", () => {
      const msg = {
        type: "nine_router_usage_response",
        payload: {
          requestId: "req-u2",
          period: "24h",
          totalRequests: 0,
          totalTokens: 0,
          totalCost: 0,
          byProvider: [],
          byModel: [],
        },
      };
      const result = NineRouterUsageResponseSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("is included in SessionOutboundMessageSchema", () => {
      const result = SessionOutboundMessageSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it("rejects response without byProvider", () => {
      const msg = {
        type: "nine_router_usage_response",
        payload: {
          requestId: "req-u3",
          period: "7d",
          totalRequests: 100,
          totalTokens: 5000,
          totalCost: 0.5,
          byModel: [],
        },
      };
      const result = NineRouterUsageResponseSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe("NineRouterOAuthImportRequest", () => {
    it("validates request with provider", () => {
      const msg = {
        type: "nine_router_oauth_import_request",
        requestId: "req-oi1",
        provider: "cursor",
      };
      const result = NineRouterOAuthImportRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("rejects request without provider", () => {
      const msg = { type: "nine_router_oauth_import_request", requestId: "req-oi2" };
      const result = NineRouterOAuthImportRequestSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("is included in SessionInboundMessageSchema", () => {
      const msg = {
        type: "nine_router_oauth_import_request",
        requestId: "req-oi3",
        provider: "kiro",
      };
      const result = SessionInboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterOAuthImportResponse", () => {
    it("validates successful import response", () => {
      const msg = {
        type: "nine_router_oauth_import_response",
        payload: {
          requestId: "req-oi1",
          success: true,
          provider: "cursor",
          email: "user@example.com",
        },
      };
      const result = NineRouterOAuthImportResponseSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("validates failed import response", () => {
      const msg = {
        type: "nine_router_oauth_import_response",
        payload: {
          requestId: "req-oi2",
          success: false,
          provider: "kiro",
          error: "No token found",
        },
      };
      const result = NineRouterOAuthImportResponseSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("is included in SessionOutboundMessageSchema", () => {
      const msg = {
        type: "nine_router_oauth_import_response",
        payload: { requestId: "req-oi3", success: true, provider: "iflow" },
      };
      const result = SessionOutboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });
});
