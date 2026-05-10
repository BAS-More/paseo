/**
 * Shared helpers for provider E2E smoke tests.
 */
import pino from "pino";
import type { AgentClient, AgentStreamEvent } from "../server/agent/agent-sdk-types.js";

export function createTestLogger() {
  return pino({ level: "silent" });
}

export async function skipIfUnavailable(client: AgentClient): Promise<string | null> {
  try {
    const available = await client.isAvailable();
    if (!available) {
      return `${client.provider} is not available (binary not installed or service not running)`;
    }
    return null;
  } catch (err) {
    return `${client.provider} availability check threw: ${err}`;
  }
}

export function waitForEvent(
  events: AgentStreamEvent[],
  type: AgentStreamEvent["type"],
  timeoutMs = 10000,
): Promise<AgentStreamEvent> {
  return new Promise((resolve, reject) => {
    const existing = events.find((e) => e.type === type);
    if (existing) {
      resolve(existing);
      return;
    }

    const interval = setInterval(() => {
      const found = events.find((e) => e.type === type);
      if (found) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve(found);
      }
    }, 100);

    const timer = setTimeout(() => {
      clearInterval(interval);
      reject(new Error(`Timed out waiting for event '${type}' after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

export function collectEvents(subscribe: (cb: (event: AgentStreamEvent) => void) => () => void): {
  events: AgentStreamEvent[];
  unsubscribe: () => void;
} {
  const events: AgentStreamEvent[] = [];
  const unsubscribe = subscribe((event) => {
    events.push(event);
  });
  return { events, unsubscribe };
}
