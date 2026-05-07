import { type ChildProcess, type SpawnOptions } from "node:child_process";
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
} from "../agent-sdk-types.js";
import { spawnProcess } from "../../../utils/spawn.js";
import { mapOccEventToStreamEvents, type OccStreamEvent } from "./occ/event-mapper.js";

export const OCC_PROVIDER_ID: AgentProvider = "occ";

export const OCC_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
};

const OCC_MODELS: AgentModelDefinition[] = [
  {
    provider: OCC_PROVIDER_ID,
    id: "claude-sonnet-4-20250514",
    label: "Claude Sonnet 4",
    description: "Default model for OpenClaude",
    isDefault: true,
  },
  {
    provider: OCC_PROVIDER_ID,
    id: "claude-opus-4-20250514",
    label: "Claude Opus 4",
    description: "Most capable model",
  },
  {
    provider: OCC_PROVIDER_ID,
    id: "claude-haiku-3-5-20241022",
    label: "Claude Haiku 3.5",
    description: "Fast, cost-effective model",
  },
];

type SpawnFn = (command: string, args?: readonly string[], options?: SpawnOptions) => ChildProcess;

function defaultSpawn(
  command: string,
  args?: readonly string[],
  options?: SpawnOptions,
): ChildProcess {
  return spawnProcess(command, (args as string[]) ?? [], options);
}

export interface OccAgentClientOptions {
  logger: Logger;
  occPath?: string;
  agentsPath?: string;
  env?: Record<string, string>;
  _spawnForTest?: SpawnFn;
}

export class OccAgentClient implements AgentClient {
  readonly provider: AgentProvider = OCC_PROVIDER_ID;
  readonly capabilities: AgentCapabilityFlags = OCC_CAPABILITIES;

  private readonly logger: Logger;
  private readonly occPath: string;
  private readonly agentsPath?: string;
  private readonly baseEnv: Record<string, string>;
  private readonly spawnFn: SpawnFn;

  constructor(options: OccAgentClientOptions) {
    this.logger = options.logger.child({ provider: OCC_PROVIDER_ID });
    this.occPath = options.occPath ?? process.env.OCC_PATH ?? "occ";
    this.agentsPath = options.agentsPath ?? process.env.OCC_AGENTS_PATH;
    this.baseEnv = options.env ?? {};
    this.spawnFn = options._spawnForTest ?? defaultSpawn;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const proc = this.spawnFn(this.occPath, ["--version"], {
        stdio: "pipe",
        timeout: 5000,
      });
      return await new Promise<boolean>((resolve) => {
        proc.on("error", () => resolve(false));
        proc.on("close", (code) => resolve(code === 0));
      });
    } catch {
      return false;
    }
  }

  async listModels(_options: ListModelsOptions): Promise<AgentModelDefinition[]> {
    return OCC_MODELS;
  }

  async createSession(
    config: AgentSessionConfig,
    _launchContext?: AgentLaunchContext,
    _options?: AgentCreateSessionOptions,
  ): Promise<AgentSession> {
    return this.spawnSession(config);
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
  ): Promise<AgentSession> {
    const config: AgentSessionConfig = {
      provider: OCC_PROVIDER_ID,
      cwd: overrides?.cwd ?? ".",
      model: overrides?.model,
      ...overrides,
    };
    return this.spawnSession(config, handle.sessionId);
  }

  private spawnSession(config: AgentSessionConfig, resumeId?: string): OccAgentSession {
    const args: string[] = [];

    if (resumeId) {
      args.push("--resume", resumeId);
    }

    if (config.model) {
      args.push("--model", config.model);
    }

    if (this.agentsPath) {
      args.push("--agents", this.agentsPath);
    }

    args.push("--output-format", "stream-json");

    const spawnEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...this.baseEnv,
    };

    const apiBase = this.baseEnv.OPENAI_API_BASE ?? process.env.OPENAI_API_BASE;
    if (apiBase) {
      spawnEnv.ANTHROPIC_BASE_URL = apiBase.replace(/\/v1$/, "");
    }

    const proc = this.spawnFn(this.occPath, args, {
      cwd: config.cwd,
      env: spawnEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const sessionId = resumeId ?? `occ-${Date.now()}`;
    return new OccAgentSession({
      provider: OCC_PROVIDER_ID,
      sessionId,
      model: config.model ?? OCC_MODELS[0].id,
      process: proc,
      logger: this.logger,
      spawnContext: {
        occPath: this.occPath,
        agentsPath: this.agentsPath,
        cwd: config.cwd ?? ".",
        env: spawnEnv,
        model: config.model,
        spawnFn: this.spawnFn,
      },
    });
  }
}

interface OccSpawnContext {
  occPath: string;
  agentsPath?: string;
  cwd: string;
  env: Record<string, string>;
  model?: string;
  spawnFn: SpawnFn;
}

interface OccSessionOptions {
  provider: AgentProvider;
  sessionId: string;
  model: string;
  process: ChildProcess;
  logger: Logger;
  spawnContext: OccSpawnContext;
}

class OccAgentSession implements AgentSession {
  readonly provider: AgentProvider;
  readonly id: string;
  readonly capabilities: AgentCapabilityFlags = OCC_CAPABILITIES;

  private sessionId: string;
  private model: string;
  private proc: ChildProcess;
  private logger: Logger;
  private spawnContext: OccSpawnContext;
  private emitter = new EventEmitter();
  private lineBuffer = "";
  private turnId: string;
  private pendingPermissions: AgentPermissionRequest[] = [];

  constructor(options: OccSessionOptions) {
    this.provider = options.provider;
    this.sessionId = options.sessionId;
    this.id = options.sessionId;
    this.model = options.model;
    this.proc = options.process;
    this.logger = options.logger;
    this.spawnContext = options.spawnContext;
    this.turnId = randomUUID();

    this.attachToProcess(this.proc);
  }

  private attachToProcess(proc: ChildProcess): void {
    this.proc = proc;
    this.lineBuffer = "";
    this.setupStdoutParsing();
    this.setupStderrParsing();
    this.setupProcessLifecycle();

    if (this.proc.stdin) {
      this.proc.stdin.end();
    }
  }

  private detachFromProcess(): void {
    this.proc.stdout?.removeAllListeners("data");
    this.proc.stderr?.removeAllListeners("data");
    this.proc.removeAllListeners("close");
    this.proc.removeAllListeners("error");
  }

  private extractPromptText(prompt: AgentPromptInput): string {
    if (typeof prompt === "string") return prompt;
    return prompt
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");
  }

  private spawnForTurn(promptText: string): void {
    this.detachFromProcess();

    const ctx = this.spawnContext;
    const args: string[] = ["-p", promptText];
    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }
    if (ctx.model) {
      args.push("--model", ctx.model);
    }
    if (ctx.agentsPath) {
      args.push("--agents", ctx.agentsPath);
    }
    args.push("--output-format", "stream-json");

    const proc = ctx.spawnFn(ctx.occPath, args, {
      cwd: ctx.cwd,
      env: ctx.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.attachToProcess(proc);
  }

  private setupStdoutParsing(): void {
    this.proc.stdout?.on("data", (chunk: Buffer) => {
      this.lineBuffer += chunk.toString();
      const lines = this.lineBuffer.split(/\r?\n/);
      this.lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        this.processLine(line);
      }
    });
  }

  private processLine(line: string): void {
    try {
      const event = JSON.parse(line) as OccStreamEvent;

      if (event.type === "system" && "subtype" in event && event.subtype === "init") {
        if ("session_id" in event && event.session_id) {
          this.sessionId = event.session_id;
        }
      }

      const mapped = mapOccEventToStreamEvents(event, {
        provider: this.provider,
        sessionId: this.sessionId,
        turnId: this.turnId,
      });

      for (const streamEvent of mapped) {
        if (streamEvent.type === "permission_requested") {
          this.pendingPermissions.push(streamEvent.request);
        }
        this.emitter.emit("event", streamEvent);
      }
    } catch {
      this.emitter.emit("event", {
        type: "timeline",
        provider: this.provider,
        turnId: this.turnId,
        item: { type: "assistant_message", text: line },
      } satisfies AgentStreamEvent);
    }
  }

  private setupStderrParsing(): void {
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      this.logger.warn({ stderr: text }, "OCC stderr output");
      this.emitter.emit("event", {
        type: "timeline",
        provider: this.provider,
        turnId: this.turnId,
        item: { type: "error", message: text },
      } satisfies AgentStreamEvent);
    });
  }

  private setupProcessLifecycle(): void {
    this.proc.on("close", (code) => {
      if (this.lineBuffer.trim()) {
        this.processLine(this.lineBuffer.trim());
        this.lineBuffer = "";
      }

      if (code !== 0) {
        this.emitter.emit("event", {
          type: "turn_failed",
          provider: this.provider,
          error: `OCC process exited with code ${code}`,
          turnId: this.turnId,
        } satisfies AgentStreamEvent);
      } else {
        this.emitter.emit("event", {
          type: "turn_completed",
          provider: this.provider,
          turnId: this.turnId,
        } satisfies AgentStreamEvent);
      }
    });

    this.proc.on("error", (err) => {
      this.emitter.emit("event", {
        type: "turn_failed",
        provider: this.provider,
        error: err.message,
        turnId: this.turnId,
      } satisfies AgentStreamEvent);
    });
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
            sessionId: this.sessionId,
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
    const promptText = this.extractPromptText(prompt);

    if (promptText) {
      this.spawnForTurn(promptText);
    }

    this.emitter.emit("event", {
      type: "turn_started",
      provider: this.provider,
      turnId: this.turnId,
    } satisfies AgentStreamEvent);

    return { turnId: this.turnId };
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    // OCC does not support history replay
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: this.provider,
      sessionId: this.sessionId,
      model: this.model,
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return [];
  }

  async getCurrentMode(): Promise<string | null> {
    return null;
  }

  async setMode(_modeId: string): Promise<void> {
    // OCC does not support mode switching
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return this.pendingPermissions;
  }

  async respondToPermission(
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {
    this.pendingPermissions = this.pendingPermissions.filter((p) => p.id !== requestId);

    this.emitter.emit("event", {
      type: "permission_resolved",
      provider: this.provider,
      requestId,
      resolution: response,
      turnId: this.turnId,
    } satisfies AgentStreamEvent);
  }

  describePersistence(): AgentPersistenceHandle | null {
    return {
      provider: this.provider,
      sessionId: this.sessionId,
    };
  }

  async interrupt(): Promise<void> {
    this.proc.kill("SIGTERM");
  }

  async close(): Promise<void> {
    this.proc.kill("SIGTERM");
    this.emitter.removeAllListeners();
  }
}
