import { describe, expect, it } from "vitest";
import {
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  NineRouterCliToolSettingsRequestSchema,
  NineRouterCliToolSettingsUpdateRequestSchema,
  NineRouterCliToolSettingsResponseSchema,
  NineRouterCliToolSettingsUpdateResponseSchema,
} from "../shared/messages.js";

describe("CLI Tool Settings message schemas", () => {
  describe("NineRouterCliToolSettingsRequestSchema", () => {
    it("validates a get request", () => {
      const result = NineRouterCliToolSettingsRequestSchema.safeParse({
        type: "nine_router_cli_tool_settings_request",
        requestId: "req-1",
        tool: "claude",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing tool", () => {
      const result = NineRouterCliToolSettingsRequestSchema.safeParse({
        type: "nine_router_cli_tool_settings_request",
        requestId: "req-1",
      });
      expect(result.success).toBe(false);
    });

    it("is in SessionInboundMessageSchema", () => {
      const result = SessionInboundMessageSchema.safeParse({
        type: "nine_router_cli_tool_settings_request",
        requestId: "req-1",
        tool: "claude",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterCliToolSettingsUpdateRequestSchema", () => {
    it("validates an update request", () => {
      const result = NineRouterCliToolSettingsUpdateRequestSchema.safeParse({
        type: "nine_router_cli_tool_settings_update_request",
        requestId: "req-2",
        tool: "codex",
        settings: { model: "gpt-4o", apiKey: "sk-abc" },
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing settings", () => {
      const result = NineRouterCliToolSettingsUpdateRequestSchema.safeParse({
        type: "nine_router_cli_tool_settings_update_request",
        requestId: "req-2",
        tool: "codex",
      });
      expect(result.success).toBe(false);
    });

    it("is in SessionInboundMessageSchema", () => {
      const result = SessionInboundMessageSchema.safeParse({
        type: "nine_router_cli_tool_settings_update_request",
        requestId: "req-2",
        tool: "codex",
        settings: { model: "gpt-4o" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterCliToolSettingsResponseSchema", () => {
    it("validates a settings response", () => {
      const result = NineRouterCliToolSettingsResponseSchema.safeParse({
        type: "nine_router_cli_tool_settings_response",
        payload: {
          requestId: "req-1",
          tool: "claude",
          installed: true,
          has9Router: true,
          settings: { model: "claude-sonnet-4-20250514", apiKey: "sk-ant-xxx" },
          settingsPath: "C:/Users/Avi/.claude/settings.json",
        },
      });
      expect(result.success).toBe(true);
    });

    it("validates with minimal fields", () => {
      const result = NineRouterCliToolSettingsResponseSchema.safeParse({
        type: "nine_router_cli_tool_settings_response",
        payload: {
          requestId: "req-1",
          tool: "claude",
          installed: false,
          has9Router: false,
          settings: {},
        },
      });
      expect(result.success).toBe(true);
    });

    it("is in SessionOutboundMessageSchema", () => {
      const result = SessionOutboundMessageSchema.safeParse({
        type: "nine_router_cli_tool_settings_response",
        payload: {
          requestId: "req-1",
          tool: "claude",
          installed: true,
          has9Router: true,
          settings: {},
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("NineRouterCliToolSettingsUpdateResponseSchema", () => {
    it("validates a success response", () => {
      const result = NineRouterCliToolSettingsUpdateResponseSchema.safeParse({
        type: "nine_router_cli_tool_settings_update_response",
        payload: {
          requestId: "req-2",
          tool: "codex",
          success: true,
        },
      });
      expect(result.success).toBe(true);
    });

    it("validates an error response", () => {
      const result = NineRouterCliToolSettingsUpdateResponseSchema.safeParse({
        type: "nine_router_cli_tool_settings_update_response",
        payload: {
          requestId: "req-2",
          tool: "codex",
          success: false,
          error: "9Router unreachable",
        },
      });
      expect(result.success).toBe(true);
    });

    it("is in SessionOutboundMessageSchema", () => {
      const result = SessionOutboundMessageSchema.safeParse({
        type: "nine_router_cli_tool_settings_update_response",
        payload: {
          requestId: "req-2",
          tool: "codex",
          success: true,
        },
      });
      expect(result.success).toBe(true);
    });
  });
});
