import type { AgentProvider, AgentStreamEvent } from "../../agent-sdk-types.js";

export type CrewAiSseEvent =
  | { type: "status"; message: string }
  | { type: "result"; output: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface CrewAiEventContext {
  provider: AgentProvider;
  turnId: string;
}

function mapStatus(
  event: Extract<CrewAiSseEvent, { type: "status" }>,
  ctx: CrewAiEventContext,
): AgentStreamEvent[] {
  return [
    {
      type: "timeline",
      provider: ctx.provider,
      turnId: ctx.turnId,
      item: { type: "assistant_message", text: event.message },
    },
  ];
}

function mapResult(
  event: Extract<CrewAiSseEvent, { type: "result" }>,
  ctx: CrewAiEventContext,
): AgentStreamEvent[] {
  return [
    {
      type: "timeline",
      provider: ctx.provider,
      turnId: ctx.turnId,
      item: { type: "assistant_message", text: event.output },
    },
    { type: "turn_completed", provider: ctx.provider, turnId: ctx.turnId },
  ];
}

function mapError(
  event: Extract<CrewAiSseEvent, { type: "error" }>,
  ctx: CrewAiEventContext,
): AgentStreamEvent[] {
  return [
    { type: "turn_failed", provider: ctx.provider, error: event.message, turnId: ctx.turnId },
  ];
}

function mapDone(
  _event: Extract<CrewAiSseEvent, { type: "done" }>,
  ctx: CrewAiEventContext,
): AgentStreamEvent[] {
  return [{ type: "turn_completed", provider: ctx.provider, turnId: ctx.turnId }];
}

type EventHandler = (event: never, ctx: CrewAiEventContext) => AgentStreamEvent[];

const EVENT_HANDLERS: Record<string, EventHandler> = {
  status: mapStatus as EventHandler,
  result: mapResult as EventHandler,
  error: mapError as EventHandler,
  done: mapDone as EventHandler,
};

export function mapCrewAiSseToStreamEvents(
  event: CrewAiSseEvent,
  ctx: CrewAiEventContext,
): AgentStreamEvent[] {
  const handler = EVENT_HANDLERS[event.type];
  if (!handler) return [];
  return handler(event as never, ctx);
}

export function parseSseLine(line: string): CrewAiSseEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data: ")) return null;

  const payload = trimmed.slice(6);
  if (payload === "[DONE]") return { type: "done" };

  try {
    return JSON.parse(payload) as CrewAiSseEvent;
  } catch {
    return null;
  }
}
