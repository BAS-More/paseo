import { describe, expect, it } from "vitest";

import {
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  ProviderConnectionTestRequestSchema,
  ProviderConnectionTestResponseSchema,
} from "../shared/messages.js";

describe("Provider Connection Test Messages", () => {
  describe("ProviderConnectionTestRequestSchema", () => {
    it("accepts valid request", () => {
      const result = ProviderConnectionTestRequestSchema.safeParse({
        type: "provider_connection_test_request",
        provider: "claude",
        requestId: "req-1",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing provider", () => {
      const result = ProviderConnectionTestRequestSchema.safeParse({
        type: "provider_connection_test_request",
        requestId: "req-1",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing requestId", () => {
      const result = ProviderConnectionTestRequestSchema.safeParse({
        type: "provider_connection_test_request",
        provider: "claude",
      });
      expect(result.success).toBe(false);
    });

    it("is included in SessionInboundMessageSchema", () => {
      const result = SessionInboundMessageSchema.safeParse({
        type: "provider_connection_test_request",
        provider: "claude",
        requestId: "req-abc",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("ProviderConnectionTestResponseSchema", () => {
    it("accepts successful response", () => {
      const result = ProviderConnectionTestResponseSchema.safeParse({
        type: "provider_connection_test_response",
        payload: {
          requestId: "req-1",
          provider: "claude",
          available: true,
          latencyMs: 42,
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts failed response with error", () => {
      const result = ProviderConnectionTestResponseSchema.safeParse({
        type: "provider_connection_test_response",
        payload: {
          requestId: "req-1",
          provider: "occ",
          available: false,
          error: "Binary not found",
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing available field", () => {
      const result = ProviderConnectionTestResponseSchema.safeParse({
        type: "provider_connection_test_response",
        payload: {
          requestId: "req-1",
          provider: "claude",
        },
      });
      expect(result.success).toBe(false);
    });

    it("is included in SessionOutboundMessageSchema", () => {
      const result = SessionOutboundMessageSchema.safeParse({
        type: "provider_connection_test_response",
        payload: {
          requestId: "req-1",
          provider: "gemini",
          available: true,
          latencyMs: 150,
        },
      });
      expect(result.success).toBe(true);
    });
  });
});
