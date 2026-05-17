import type { AgentProvider, AgentStreamEvent } from "../../agent-sdk-types.js";

export type GeminiStreamEvent =
  | { type: "init"; session_id?: string }
  | {
      type: "message";
      role: string;
      content: string;
      delta?: boolean;
    }
  | {
      type: "tool_use";
      tool_id: string;
      tool_name: string;
      parameters: unknown;
    }
  | {
      type: "tool_result";
      tool_id: string;
      output: string;
      status: string;
    }
  | { type: "result"; stats?: { total_tokens?: number } }
  | { type: "error"; error?: string; message?: string };

export interface GeminiEventContext {
  provider: AgentProvider;
  turnId: string;
}

function mapInit(
  event: Extract<GeminiStreamEvent, { type: "init" }>,
  ctx: GeminiEventContext,
): AgentStreamEvent[] {
  return [
    {
      type: "thread_started",
      provider: ctx.provider,
      sessionId: event.session_id ?? "",
    },
  ];
}

function mapMessage(
  event: Extract<GeminiStreamEvent, { type: "message" }>,
  ctx: GeminiEventContext,
): AgentStreamEvent[] {
  if (event.role !== "assistant") return [];

  const timeline: AgentStreamEvent = {
    type: "timeline",
    provider: ctx.provider,
    turnId: ctx.turnId,
    item: { type: "assistant_message", text: event.content },
  };

  if (event.delta === false || event.delta === undefined) {
    return [timeline, { type: "turn_completed", provider: ctx.provider, turnId: ctx.turnId }];
  }

  return [timeline];
}

function mapToolUse(
  event: Extract<GeminiStreamEvent, { type: "tool_use" }>,
  ctx: GeminiEventContext,
): AgentStreamEvent[] {
  return [
    {
      type: "timeline",
      provider: ctx.provider,
      turnId: ctx.turnId,
      item: {
        type: "tool_call",
        callId: event.tool_id,
        name: event.tool_name,
        detail: { type: "unknown", input: event.parameters, output: null },
        status: "running" as const,
        error: null,
      },
    },
  ];
}

function mapToolResult(
  event: Extract<GeminiStreamEvent, { type: "tool_result" }>,
  ctx: GeminiEventContext,
): AgentStreamEvent[] {
  if (event.status === "error") {
    return [
      {
        type: "timeline",
        provider: ctx.provider,
        turnId: ctx.turnId,
        item: {
          type: "tool_call" as const,
          callId: event.tool_id,
          name: "",
          detail: { type: "unknown" as const, input: null, output: event.output },
          status: "failed" as const,
          error: event.output,
        },
      },
    ];
  }

  return [
    {
      type: "timeline",
      provider: ctx.provider,
      turnId: ctx.turnId,
      item: {
        type: "tool_call" as const,
        callId: event.tool_id,
        name: "",
        detail: { type: "unknown" as const, input: null, output: event.output },
        status: "completed" as const,
        error: null,
      },
    },
  ];
}

function mapResult(
  _event: Extract<GeminiStreamEvent, { type: "result" }>,
  ctx: GeminiEventContext,
): AgentStreamEvent[] {
  return [{ type: "turn_completed", provider: ctx.provider, turnId: ctx.turnId }];
}

function mapError(
  event: Extract<GeminiStreamEvent, { type: "error" }>,
  ctx: GeminiEventContext,
): AgentStreamEvent[] {
  return [
    {
      type: "turn_failed",
      provider: ctx.provider,
      error: event.error ?? event.message ?? "Unknown error",
      turnId: ctx.turnId,
    },
  ];
}

type EventHandler = (event: never, ctx: GeminiEventContext) => AgentStreamEvent[];

const EVENT_HANDLERS: Record<string, EventHandler> = {
  init: mapInit as EventHandler,
  message: mapMessage as EventHandler,
  tool_use: mapToolUse as EventHandler,
  tool_result: mapToolResult as EventHandler,
  result: mapResult as EventHandler,
  error: mapError as EventHandler,
};

export function mapGeminiEventToStreamEvents(
  event: GeminiStreamEvent,
  ctx: GeminiEventContext,
): AgentStreamEvent[] {
  const handler = EVENT_HANDLERS[event.type];
  if (!handler) return [];
  return handler(event as never, ctx);
}
