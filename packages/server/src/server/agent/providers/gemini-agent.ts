import {
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncReturns,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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
import { terminateWithTreeKill } from "../../../utils/tree-kill.js";
import { mapGeminiEventToStreamEvents, type GeminiStreamEvent } from "./gemini/event-mapper.js";

export const GEMINI_PROVIDER_ID: AgentProvider = "gemini";

export const GEMINI_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: true,
};

const GEMINI_MODELS: AgentModelDefinition[] = [
  {
    provider: GEMINI_PROVIDER_ID,
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    description: "Fast, cost-effective model",
    isDefault: true,
  },
  {
    provider: GEMINI_PROVIDER_ID,
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    description: "Most capable Gemini model",
  },
];

type SpawnFn = (command: string, args?: readonly string[], options?: SpawnOptions) => ChildProcess;
type SpawnSyncFn = (
  command: string,
  args?: readonly string[],
  options?: SpawnOptions,
) => SpawnSyncReturns<string>;

function defaultSpawn(
  command: string,
  args?: readonly string[],
  options?: SpawnOptions,
): ChildProcess {
  return spawnProcess(command, (args as string[]) ?? [], options);
}

function nodeSpawnSync(
  command: string,
  args?: readonly string[],
  options?: SpawnOptions,
): SpawnSyncReturns<string> {
  return spawnSync(command, args as string[], { ...options, encoding: "utf8" });
}

type ReadFileFn = (path: string) => Promise<string>;

export interface GeminiAgentClientOptions {
  logger: Logger;
  geminiPath?: string;
  env?: Record<string, string>;
  _spawnForTest?: SpawnFn;
  _spawnSyncForTest?: SpawnSyncFn;
  _readFileForTest?: ReadFileFn;
}

export class GeminiAgentClient implements AgentClient {
  readonly provider: AgentProvider = GEMINI_PROVIDER_ID;
  readonly capabilities: AgentCapabilityFlags = GEMINI_CAPABILITIES;

  private readonly logger: Logger;
  private readonly geminiPath: string;
  private readonly baseEnv: Record<string, string>;
  private readonly spawnFn: SpawnFn;
  private readonly spawnSyncFn: SpawnSyncFn;
  private readonly readFileFn: ReadFileFn;

  constructor(options: GeminiAgentClientOptions) {
    this.logger = options.logger.child({ provider: GEMINI_PROVIDER_ID });
    this.geminiPath = options.geminiPath ?? process.env.GEMINI_PATH ?? "gemini";
    this.baseEnv = options.env ?? {};
    this.spawnFn = options._spawnForTest ?? defaultSpawn;
    this.spawnSyncFn = options._spawnSyncForTest ?? nodeSpawnSync;
    this.readFileFn = options._readFileForTest ?? ((p: string) => readFile(p, "utf8"));
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = this.spawnSyncFn(this.geminiPath, ["--version"], {
        timeout: 5000,
      });
      return result.status === 0 && !result.error;
    } catch {
      return false;
    }
  }

  async listModels(_options: ListModelsOptions): Promise<AgentModelDefinition[]> {
    return GEMINI_MODELS;
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
      provider: GEMINI_PROVIDER_ID,
      cwd: overrides?.cwd ?? ".",
      model: overrides?.model,
      ...overrides,
    };
    return this.spawnSession(config, handle.sessionId);
  }

  private async detectMcpConfig(cwd?: string): Promise<string | null> {
    try {
      const configPath = join(homedir(), ".gemini.json");
      const raw = await this.readFileFn(configPath);
      const config = JSON.parse(raw) as Record<string, unknown>;

      if (
        config.mcpServers &&
        typeof config.mcpServers === "object" &&
        Object.keys(config.mcpServers as object).length > 0
      ) {
        return configPath;
      }

      if (cwd && config.geminiProjects && typeof config.geminiProjects === "object") {
        const projects = config.geminiProjects as Record<string, Record<string, unknown>>;
        const projectConfig = projects[cwd];
        if (
          projectConfig?.mcpServers &&
          typeof projectConfig.mcpServers === "object" &&
          Object.keys(projectConfig.mcpServers as object).length > 0
        ) {
          return configPath;
        }
      }
    } catch {
      // Config file doesn't exist or isn't parsable
    }
    return null;
  }

  private async spawnSession(
    config: AgentSessionConfig,
    resumeId?: string,
  ): Promise<GeminiAgentSession> {
    const args: string[] = [];

    if (config.systemPrompt) {
      args.push("--prompt", config.systemPrompt);
    }

    if (resumeId) {
      args.push("--resume", resumeId);
    }

    if (config.model) {
      args.push("--model", config.model);
    }

    const mcpConfigPath = await this.detectMcpConfig(config.cwd);
    if (mcpConfigPath) {
      args.push("--mcp-config", mcpConfigPath);
    }

    args.push("--output-format", "stream-json");

    const spawnEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...this.baseEnv,
    };

    const proc = this.spawnFn(this.geminiPath, args, {
      cwd: config.cwd,
      env: spawnEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const sessionId = resumeId ?? `gemini-${Date.now()}`;
    return new GeminiAgentSession({
      provider: GEMINI_PROVIDER_ID,
      sessionId,
      model: config.model ?? GEMINI_MODELS[0].id,
      process: proc,
      logger: this.logger,
      spawnContext: {
        geminiPath: this.geminiPath,
        cwd: config.cwd ?? ".",
        env: spawnEnv,
        model: config.model,
        spawnFn: this.spawnFn,
      },
    });
  }
}

interface GeminiSpawnContext {
  geminiPath: string;
  cwd: string;
  env: Record<string, string>;
  model?: string;
  spawnFn: SpawnFn;
}

interface GeminiSessionOptions {
  provider: AgentProvider;
  sessionId: string;
  model: string;
  process: ChildProcess;
  logger: Logger;
  spawnContext: GeminiSpawnContext;
}

class GeminiAgentSession implements AgentSession {
  readonly provider: AgentProvider;
  readonly id: string;
  readonly capabilities: AgentCapabilityFlags = GEMINI_CAPABILITIES;

  private sessionId: string;
  private model: string;
  private proc: ChildProcess;
  private logger: Logger;
  private spawnContext: GeminiSpawnContext;
  private emitter = new EventEmitter();
  private lineBuffer = "";
  private turnId: string;

  constructor(options: GeminiSessionOptions) {
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
    this.setupStderrHandling();
    this.setupProcessLifecycle();

    if (this.proc.stdin) {
      (this.proc.stdin as NodeJS.WritableStream).end();
    }
  }

  private detachFromProcess(): void {
    this.proc.stdout?.removeAllListeners("data");
    this.proc.stderr?.removeAllListeners("data");
    this.proc.removeAllListeners("close");
    this.proc.removeAllListeners("error");
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
      const event = JSON.parse(line) as GeminiStreamEvent;

      if (event.type === "init" && event.session_id) {
        this.sessionId = event.session_id;
      }

      const mapped = mapGeminiEventToStreamEvents(event, {
        provider: this.provider,
        turnId: this.turnId,
      });

      for (const streamEvent of mapped) {
        this.emitter.emit("event", streamEvent);
      }
    } catch {
      this.logger.debug({ line }, "Non-JSON line from Gemini CLI");
    }
  }

  private setupStderrHandling(): void {
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (!text) return;
      if (text.includes("DeprecationWarning") || text.includes("Loaded cached credentials")) return;

      this.logger.warn({ stderr: text }, "Gemini stderr output");
      this.emitter.emit("event", {
        type: "turn_failed",
        provider: this.provider,
        error: text,
        turnId: this.turnId,
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
          error: `Gemini process exited with code ${code}`,
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

  private extractPromptText(prompt: AgentPromptInput): string {
    if (typeof prompt === "string") return prompt;
    return prompt
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");
  }

  private spawnForTurn(promptText: string): void {
    this.detachFromProcess();

    const args: string[] = ["--prompt", promptText];
    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }
    if (this.model) {
      args.push("--model", this.model);
    }
    args.push("--output-format", "stream-json");

    const ctx = this.spawnContext;
    const proc = ctx.spawnFn(ctx.geminiPath, args, {
      cwd: ctx.cwd,
      env: ctx.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.attachToProcess(proc);
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
    // Gemini history replay not implemented in adapter
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: this.provider,
      sessionId: this.id,
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
    // Gemini modes handled via CLI flags at spawn time
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [];
  }

  async respondToPermission(
    _requestId: string,
    _response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {
    // Gemini permissions are set at spawn time, not interactive
  }

  describePersistence(): AgentPersistenceHandle | null {
    return {
      provider: this.provider,
      sessionId: this.sessionId,
    };
  }

  async interrupt(): Promise<void> {
    // H-01: tree-kill ensures spawned grandchildren (gemini → mcp servers) die too.
    await terminateWithTreeKill(this.proc, {
      gracefulTimeoutMs: 5_000,
      forceTimeoutMs: 5_000,
    });
  }

  async close(): Promise<void> {
    await terminateWithTreeKill(this.proc, {
      gracefulTimeoutMs: 5_000,
      forceTimeoutMs: 5_000,
    });
    this.emitter.removeAllListeners();
  }
}
