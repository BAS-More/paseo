import { describe, expect, it } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "../shared/messages.js";
import {
  NineRouterModelAliasesRequestSchema,
  NineRouterModelAliasesResponseSchema,
  NineRouterSetModelAliasRequestSchema,
  NineRouterSetModelAliasResponseSchema,
  NineRouterDeleteModelAliasRequestSchema,
  NineRouterDeleteModelAliasResponseSchema,
  NineRouterTestModelRequestSchema,
  NineRouterTestModelResponseSchema,
} from "./nine-router-model-schemas.js";

describe("Model Aliases message schemas", () => {
  describe("NineRouterModelAliasesRequestSchema", () => {
    it("validates get aliases request", () => {
      const result = NineRouterModelAliasesRequestSchema.safeParse({
        type: "nine_router_model_aliases_request",
        requestId: "req-1",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing requestId", () => {
      const result = NineRouterModelAliasesRequestSchema.safeParse({
        type: "nine_router_model_aliases_request",
      });
      expect(result.success).toBe(false);
    });

    it("is in SessionInboundMessageSchema", () => {
      const result = SessionInboundMessageSchema.safeParse({
        type: "nine_router_model_aliases_request",
        requestId: "req-1",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterModelAliasesResponseSchema", () => {
    it("validates aliases response", () => {
      const result = NineRouterModelAliasesResponseSchema.safeParse({
        type: "nine_router_model_aliases_response",
        payload: {
          requestId: "req-1",
          aliases: { best: "claude-sonnet-4-20250514", fast: "gpt-4o-mini" },
        },
      });
      expect(result.success).toBe(true);
    });

    it("validates empty aliases", () => {
      const result = NineRouterModelAliasesResponseSchema.safeParse({
        type: "nine_router_model_aliases_response",
        payload: { requestId: "req-1", aliases: {} },
      });
      expect(result.success).toBe(true);
    });

    it("is in SessionOutboundMessageSchema", () => {
      const result = SessionOutboundMessageSchema.safeParse({
        type: "nine_router_model_aliases_response",
        payload: { requestId: "req-1", aliases: {} },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterSetModelAliasRequestSchema", () => {
    it("validates set alias request", () => {
      const result = NineRouterSetModelAliasRequestSchema.safeParse({
        type: "nine_router_set_model_alias_request",
        requestId: "req-2",
        alias: "best",
        target: "claude-sonnet-4-20250514",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing alias", () => {
      const result = NineRouterSetModelAliasRequestSchema.safeParse({
        type: "nine_router_set_model_alias_request",
        requestId: "req-2",
        target: "claude-sonnet-4-20250514",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing target", () => {
      const result = NineRouterSetModelAliasRequestSchema.safeParse({
        type: "nine_router_set_model_alias_request",
        requestId: "req-2",
        alias: "best",
      });
      expect(result.success).toBe(false);
    });

    it("is in SessionInboundMessageSchema", () => {
      const result = SessionInboundMessageSchema.safeParse({
        type: "nine_router_set_model_alias_request",
        requestId: "req-2",
        alias: "best",
        target: "claude-sonnet-4-20250514",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterSetModelAliasResponseSchema", () => {
    it("validates success response", () => {
      const result = NineRouterSetModelAliasResponseSchema.safeParse({
        type: "nine_router_set_model_alias_response",
        payload: { requestId: "req-2", success: true },
      });
      expect(result.success).toBe(true);
    });

    it("validates error response", () => {
      const result = NineRouterSetModelAliasResponseSchema.safeParse({
        type: "nine_router_set_model_alias_response",
        payload: { requestId: "req-2", success: false, error: "Invalid target model" },
      });
      expect(result.success).toBe(true);
    });

    it("is in SessionOutboundMessageSchema", () => {
      const result = SessionOutboundMessageSchema.safeParse({
        type: "nine_router_set_model_alias_response",
        payload: { requestId: "req-2", success: true },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterDeleteModelAliasRequestSchema", () => {
    it("validates delete request", () => {
      const result = NineRouterDeleteModelAliasRequestSchema.safeParse({
        type: "nine_router_delete_model_alias_request",
        requestId: "req-3",
        alias: "best",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing alias", () => {
      const result = NineRouterDeleteModelAliasRequestSchema.safeParse({
        type: "nine_router_delete_model_alias_request",
        requestId: "req-3",
      });
      expect(result.success).toBe(false);
    });

    it("is in SessionInboundMessageSchema", () => {
      const result = SessionInboundMessageSchema.safeParse({
        type: "nine_router_delete_model_alias_request",
        requestId: "req-3",
        alias: "best",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterDeleteModelAliasResponseSchema", () => {
    it("validates delete response", () => {
      const result = NineRouterDeleteModelAliasResponseSchema.safeParse({
        type: "nine_router_delete_model_alias_response",
        payload: { requestId: "req-3", success: true },
      });
      expect(result.success).toBe(true);
    });

    it("validates delete error response", () => {
      const result = NineRouterDeleteModelAliasResponseSchema.safeParse({
        type: "nine_router_delete_model_alias_response",
        payload: { requestId: "req-3", success: false, error: "Alias not found" },
      });
      expect(result.success).toBe(true);
    });

    it("is in SessionOutboundMessageSchema", () => {
      const result = SessionOutboundMessageSchema.safeParse({
        type: "nine_router_delete_model_alias_response",
        payload: { requestId: "req-3", success: true },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterTestModelRequestSchema", () => {
    it("validates test model request", () => {
      const result = NineRouterTestModelRequestSchema.safeParse({
        type: "nine_router_test_model_request",
        requestId: "req-4",
        model: "claude-sonnet-4-20250514",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing model", () => {
      const result = NineRouterTestModelRequestSchema.safeParse({
        type: "nine_router_test_model_request",
        requestId: "req-4",
      });
      expect(result.success).toBe(false);
    });

    it("is in SessionInboundMessageSchema", () => {
      const result = SessionInboundMessageSchema.safeParse({
        type: "nine_router_test_model_request",
        requestId: "req-4",
        model: "claude-sonnet-4-20250514",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterTestModelResponseSchema", () => {
    it("validates success response", () => {
      const result = NineRouterTestModelResponseSchema.safeParse({
        type: "nine_router_test_model_response",
        payload: {
          requestId: "req-4",
          success: true,
          latencyMs: 450,
          provider: "anthropic",
        },
      });
      expect(result.success).toBe(true);
    });

    it("validates failure response", () => {
      const result = NineRouterTestModelResponseSchema.safeParse({
        type: "nine_router_test_model_response",
        payload: {
          requestId: "req-4",
          success: false,
          latencyMs: 0,
          provider: "",
        },
      });
      expect(result.success).toBe(true);
    });

    it("is in SessionOutboundMessageSchema", () => {
      const result = SessionOutboundMessageSchema.safeParse({
        type: "nine_router_test_model_response",
        payload: {
          requestId: "req-4",
          success: true,
          latencyMs: 200,
          provider: "openai",
        },
      });
      expect(result.success).toBe(true);
    });
  });
});
