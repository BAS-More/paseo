import type { AgentProvider, AgentStreamEvent } from "../../agent-sdk-types.js";

/**
 * Raw event shapes emitted by the OCC binary on stdout as JSON lines.
 */
export type OccStreamEvent =
  | { type: "system"; subtype: "init"; session_id?: string }
  | { type: "stream_event"; text?: string; delta?: string }
  | {
      type: "assistant";
      message: { content: Array<{ type: string; text?: string }> };
    }
  | {
      type: "tool_use";
      name: string;
      input: unknown;
      tool_use_id: string;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error: boolean;
    }
  | { type: "thinking"; content?: string; thinking?: string }
  | { type: "error"; message?: string; error?: string }
  | { type: "result"; subtype: string; result?: string }
  | { type: "stop"; reason?: string }
  | {
      type: "permission_request";
      tool_name: string;
      input: unknown;
      request_id: string;
    }
  | {
      type: "agent_spawn";
      description: string;
      prompt: string;
      agent_id: string;
    }
  | { type: "stream_request_start"; turn?: number }
  | { type: "compaction"; count?: number };

export interface OccEventContext {
  provider: AgentProvider;
  sessionId: string;
  turnId: string;
}

type EventHandler = (event: never, ctx: OccEventContext) => AgentStreamEvent[];

function mapSystem(
  event: Extract<OccStreamEvent, { type: "system" }>,
  ctx: OccEventContext,
): AgentStreamEvent[] {
  if (event.subtype === "init") {
    return [
      {
        type: "thread_started",
        sessionId: event.session_id ?? ctx.sessionId,
        provider: ctx.provider,
      },
    ];
  }
  return [];
}

function mapStreamEvent(
  event: Extract<OccStreamEvent, { type: "stream_event" }>,
  ctx: OccEventContext,
): AgentStreamEvent[] {
  return [
    {
      type: "timeline",
      provider: ctx.provider,
      turnId: ctx.turnId,
      item: { type: "assistant_message", text: event.text ?? event.delta ?? "" },
    },
  ];
}

function mapAssistant(
  event: Extract<OccStreamEvent, { type: "assistant" }>,
  ctx: OccEventContext,
): AgentStreamEvent[] {
  const textBlock = event.message?.content?.find((b) => b.type === "text" && b.text);
  if (!textBlock?.text) return [];
  return [
    {
      type: "timeline",
      provider: ctx.provider,
      turnId: ctx.turnId,
      item: { type: "assistant_message", text: textBlock.text },
    },
  ];
}

function mapToolUse(
  event: Extract<OccStreamEvent, { type: "tool_use" }>,
  ctx: OccEventContext,
): AgentStreamEvent[] {
  return [
    {
      type: "timeline",
      provider: ctx.provider,
      turnId: ctx.turnId,
      item: {
        type: "tool_call",
        callId: event.tool_use_id,
        name: event.name,
        status: "running",
        error: null,
        detail: { type: "unknown", input: event.input, output: null },
      },
    },
  ];
}

function mapToolResult(
  event: Extract<OccStreamEvent, { type: "tool_result" }>,
  ctx: OccEventContext,
): AgentStreamEvent[] {
  const base = {
    type: "timeline" as const,
    provider: ctx.provider,
    turnId: ctx.turnId,
  };
  const detail = { type: "unknown" as const, input: null, output: event.content };

  if (event.is_error) {
    return [
      {
        ...base,
        item: {
          type: "tool_call" as const,
          callId: event.tool_use_id,
          name: "",
          status: "failed" as const,
          error: event.content,
          detail,
        },
      },
    ];
  }
  return [
    {
      ...base,
      item: {
        type: "tool_call" as const,
        callId: event.tool_use_id,
        name: "",
        status: "completed" as const,
        error: null,
        detail,
      },
    },
  ];
}

function mapThinking(
  event: Extract<OccStreamEvent, { type: "thinking" }>,
  ctx: OccEventContext,
): AgentStreamEvent[] {
  return [
    {
      type: "timeline",
      provider: ctx.provider,
      turnId: ctx.turnId,
      item: { type: "reasoning", text: event.content ?? event.thinking ?? "" },
    },
  ];
}

function mapError(
  event: Extract<OccStreamEvent, { type: "error" }>,
  ctx: OccEventContext,
): AgentStreamEvent[] {
  return [
    {
      type: "timeline",
      provider: ctx.provider,
      turnId: ctx.turnId,
      item: { type: "error", message: event.message ?? event.error ?? "Unknown error" },
    },
  ];
}

function mapResult(
  event: Extract<OccStreamEvent, { type: "result" }>,
  ctx: OccEventContext,
): AgentStreamEvent[] {
  if (event.subtype === "success") {
    return [{ type: "turn_completed", provider: ctx.provider, turnId: ctx.turnId }];
  }
  return [
    {
      type: "turn_failed",
      provider: ctx.provider,
      error: event.result ?? "OCC run failed",
      turnId: ctx.turnId,
    },
  ];
}

function mapStop(
  _event: Extract<OccStreamEvent, { type: "stop" }>,
  ctx: OccEventContext,
): AgentStreamEvent[] {
  return [{ type: "turn_completed", provider: ctx.provider, turnId: ctx.turnId }];
}

function mapPermissionRequest(
  event: Extract<OccStreamEvent, { type: "permission_request" }>,
  ctx: OccEventContext,
): AgentStreamEvent[] {
  return [
    {
      type: "permission_requested",
      provider: ctx.provider,
      turnId: ctx.turnId,
      request: {
        id: event.request_id,
        provider: ctx.provider,
        name: event.tool_name,
        kind: "tool",
        title: `Tool permission: ${event.tool_name}`,
        input: event.input as Record<string, unknown>,
      },
    },
  ];
}

function mapAgentSpawn(
  event: Extract<OccStreamEvent, { type: "agent_spawn" }>,
  ctx: OccEventContext,
): AgentStreamEvent[] {
  return [
    {
      type: "timeline",
      provider: ctx.provider,
      turnId: ctx.turnId,
      item: {
        type: "tool_call",
        callId: event.agent_id,
        name: "Agent",
        status: "running",
        error: null,
        detail: { type: "sub_agent", description: event.description, log: event.prompt },
      },
    },
  ];
}

function mapStreamRequestStart(
  _event: Extract<OccStreamEvent, { type: "stream_request_start" }>,
  ctx: OccEventContext,
): AgentStreamEvent[] {
  return [{ type: "turn_started", provider: ctx.provider, turnId: ctx.turnId }];
}

function mapCompaction(
  _event: Extract<OccStreamEvent, { type: "compaction" }>,
  ctx: OccEventContext,
): AgentStreamEvent[] {
  return [
    {
      type: "timeline",
      provider: ctx.provider,
      turnId: ctx.turnId,
      item: { type: "compaction", status: "completed" },
    },
  ];
}

const EVENT_HANDLERS: Record<string, EventHandler> = {
  system: mapSystem as EventHandler,
  stream_event: mapStreamEvent as EventHandler,
  assistant: mapAssistant as EventHandler,
  tool_use: mapToolUse as EventHandler,
  tool_result: mapToolResult as EventHandler,
  thinking: mapThinking as EventHandler,
  error: mapError as EventHandler,
  result: mapResult as EventHandler,
  stop: mapStop as EventHandler,
  permission_request: mapPermissionRequest as EventHandler,
  agent_spawn: mapAgentSpawn as EventHandler,
  stream_request_start: mapStreamRequestStart as EventHandler,
  compaction: mapCompaction as EventHandler,
};

export function mapOccEventToStreamEvents(
  event: OccStreamEvent,
  ctx: OccEventContext,
): AgentStreamEvent[] {
  const handler = EVENT_HANDLERS[event.type];
  if (!handler) return [];
  return handler(event as never, ctx);
}
