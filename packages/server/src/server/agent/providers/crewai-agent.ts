import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Logger } from "pino";

import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentCreateSessionOptions,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPermissionResult,
  AgentPromptInput,
  AgentProvider,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  ListModelsOptions,
  PersistedAgentDescriptor,
  ListPersistedAgentsOptions,
} from "../agent-sdk-types.js";
import { mapCrewAiSseToStreamEvents, parseSseLine } from "./crewai/event-mapper.js";

export const CREWAI_PROVIDER_ID: AgentProvider = "crewai";

export const CREWAI_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};

type FetchFn = typeof globalThis.fetch;

export interface CrewAiAgentClientOptions {
  logger: Logger;
  bridgeUrl?: string;
  _fetchForTest?: FetchFn;
}

export class CrewAiAgentClient implements AgentClient {
  readonly provider: AgentProvider = CREWAI_PROVIDER_ID;
  readonly capabilities: AgentCapabilityFlags = CREWAI_CAPABILITIES;

  private readonly logger: Logger;
  private readonly bridgeUrl: string;
  private readonly fetchFn: FetchFn;

  constructor(options: CrewAiAgentClientOptions) {
    this.logger = options.logger.child({ provider: CREWAI_PROVIDER_ID });
    this.bridgeUrl = options.bridgeUrl ?? process.env.CREWAI_BRIDGE_URL ?? "http://localhost:8000";
    this.fetchFn = options._fetchForTest ?? globalThis.fetch;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.bridgeUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(_options: ListModelsOptions): Promise<AgentModelDefinition[]> {
    try {
      const response = await this.fetchFn(`${this.bridgeUrl}/crew/list`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];

      const crews = (await response.json()) as Array<{
        id: string;
        name?: string;
        description?: string;
      }>;
      return crews.map((crew, index) => ({
        provider: CREWAI_PROVIDER_ID,
        id: crew.id,
        label: crew.name ?? crew.id,
        description: crew.description,
        isDefault: index === 0,
      }));
    } catch {
      return [];
    }
  }

  async listPersistedAgents(
    _options?: ListPersistedAgentsOptions,
  ): Promise<PersistedAgentDescriptor[]> {
    return [];
  }

  async createSession(
    config: AgentSessionConfig,
    _launchContext?: AgentLaunchContext,
    _options?: AgentCreateSessionOptions,
  ): Promise<AgentSession> {
    const sessionId = `crewai-${Date.now()}`;
    return new CrewAiAgentSession({
      provider: CREWAI_PROVIDER_ID,
      sessionId,
      crewId: config.model ?? "",
      bridgeUrl: this.bridgeUrl,
      fetchFn: this.fetchFn,
      logger: this.logger,
    });
  }

  async resumeSession(
    _handle: AgentPersistenceHandle,
    _overrides?: Partial<AgentSessionConfig>,
  ): Promise<AgentSession> {
    throw new Error("CrewAI does not support session resume — not supported");
  }
}

interface CrewAiSessionOptions {
  provider: AgentProvider;
  sessionId: string;
  crewId: string;
  bridgeUrl: string;
  fetchFn: FetchFn;
  logger: Logger;
}

class CrewAiAgentSession implements AgentSession {
  readonly provider: AgentProvider;
  readonly id: string;
  readonly capabilities: AgentCapabilityFlags = CREWAI_CAPABILITIES;

  private readonly crewId: string;
  private readonly bridgeUrl: string;
  private readonly fetchFn: FetchFn;
  private readonly logger: Logger;
  private readonly emitter = new EventEmitter();
  private turnId: string;
  private abortController: AbortController | null = null;

  constructor(options: CrewAiSessionOptions) {
    this.provider = options.provider;
    this.id = options.sessionId;
    this.crewId = options.crewId;
    this.bridgeUrl = options.bridgeUrl;
    this.fetchFn = options.fetchFn;
    this.logger = options.logger;
    this.turnId = randomUUID();
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.emitter.on("event", callback);
    return () => this.emitter.off("event", callback);
  }

  async run(prompt: AgentPromptInput, _options?: AgentRunOptions): Promise<AgentRunResult> {
    await this.startTurn(prompt);

    return new Promise<AgentRunResult>((resolve) => {
      const onEvent = (event: AgentStreamEvent) => {
        if (event.type === "turn_completed" || event.type === "turn_failed") {
          this.emitter.off("event", onEvent);
          resolve({
            sessionId: this.id,
            finalText: "",
            timeline: [],
          });
        }
      };
      this.emitter.on("event", onEvent);
    });
  }

  async startTurn(
    prompt: AgentPromptInput,
    _options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    this.turnId = randomUUID();
    this.abortController = new AbortController();

    this.emitter.emit("event", {
      type: "turn_started",
      provider: this.provider,
      turnId: this.turnId,
    } satisfies AgentStreamEvent);

    const promptText =
      typeof prompt === "string"
        ? prompt
        : prompt
            .filter((b) => b.type === "text")
            .map((b) => (b as { type: "text"; text: string }).text)
            .join("\n");

    this.runCrewStream(promptText, this.turnId, this.abortController.signal).catch((err) => {
      this.logger.error({ err }, "CrewAI stream failed");
      this.emitter.emit("event", {
        type: "turn_failed",
        provider: this.provider,
        error: err instanceof Error ? err.message : String(err),
        turnId: this.turnId,
      } satisfies AgentStreamEvent);
    });

    return { turnId: this.turnId };
  }

  private async runCrewStream(prompt: string, turnId: string, signal: AbortSignal): Promise<void> {
    const response = await this.fetchFn(`${this.bridgeUrl}/crew/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crew_id: this.crewId, inputs: { prompt } }),
      signal,
    });

    if (!response.ok || !response.body) {
      this.emitter.emit("event", {
        type: "turn_failed",
        provider: this.provider,
        error: `Bridge returned ${response.status}`,
        turnId,
      } satisfies AgentStreamEvent);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const sseEvent = parseSseLine(line);
          if (!sseEvent) continue;

          const mapped = mapCrewAiSseToStreamEvents(sseEvent, {
            provider: this.provider,
            turnId,
          });
          for (const event of mapped) {
            this.emitter.emit("event", event);
          }
        }
      }
    } catch (err) {
      if (!signal.aborted) throw err;
    }
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    // CrewAI does not support history replay
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.crewId || null,
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return [];
  }

  async getCurrentMode(): Promise<string | null> {
    return null;
  }

  async setMode(_modeId: string): Promise<void> {
    // CrewAI has a single mode
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [];
  }

  async respondToPermission(
    _requestId: string,
    _response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {
    // CrewAI does not request permissions
  }

  describePersistence(): AgentPersistenceHandle | null {
    return null;
  }

  async interrupt(): Promise<void> {
    this.abortController?.abort();
  }

  async close(): Promise<void> {
    this.abortController?.abort();
    this.emitter.removeAllListeners();
  }
}
