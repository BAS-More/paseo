import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Server as HTTPServer } from "http";
import type pino from "pino";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import type { DownloadTokenStore } from "./file-download/token-store.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import type { FileBackedChatService } from "./chat/chat-service.js";
import type { LoopService } from "./loop-service.js";
import type { ScheduleService } from "./schedule/service.js";
import type { CheckoutDiffManager } from "./checkout-diff-manager.js";
import { createStub, asInternals } from "./test-utils/class-mocks.js";

type SocketListener = (...args: unknown[]) => void;

const authModule = vi.hoisted(() => {
  return {
    isBearerTokenValidAsync: vi.fn(async () => true),
    isBearerTokenValid: vi.fn(() => true),
    extractWsBearerProtocol: vi.fn(() => "paseo.bearer.test-token"),
    extractWsBearerToken: vi.fn(() => "test-token"),
  };
});

vi.mock("./auth.js", () => ({
  ...authModule,
}));

const wsModuleMock = vi.hoisted(() => {
  class MockWebSocketServer {
    static instances: MockWebSocketServer[] = [];
    readonly handlers = new Map<string, (...args: unknown[]) => void>();

    constructor(_options: unknown) {
      MockWebSocketServer.instances.push(this);
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }

    close() {
      // no-op
    }
  }

  return { MockWebSocketServer };
});

const sessionMock = vi.hoisted(() => {
  const instances: MockSession[] = [];

  class MockSession {
    cleanup = vi.fn(async () => {});
    handleMessage = vi.fn(async () => {});
    handleBinaryFrame = vi.fn((_frame: unknown) => {});
    supports = vi.fn(() => false);
    getClientActivity = vi.fn(() => null);
    resetPeakInflight = vi.fn(() => {});
    getRuntimeMetrics = vi.fn(() => ({
      checkoutDiffTargetCount: 0,
      checkoutDiffSubscriptionCount: 0,
      checkoutDiffWatcherCount: 0,
      checkoutDiffFallbackRefreshTargetCount: 0,
      terminalDirectorySubscriptionCount: 0,
      terminalSubscriptionCount: 0,
      inflightRequests: 0,
      peakInflightRequests: 0,
    }));
    readonly args: Record<string, unknown>;

    constructor(args: Record<string, unknown>) {
      this.args = args;
      instances.push(this);
    }
  }

  return { MockSession, instances };
});

vi.mock("ws", () => ({
  WebSocketServer: wsModuleMock.MockWebSocketServer,
}));

vi.mock("./session.js", () => ({
  Session: sessionMock.MockSession,
}));

vi.mock("./push/token-store.js", () => ({
  PushTokenStore: class {
    getAllTokens(): string[] {
      return [];
    }
  },
}));

vi.mock("./push/push-service.js", () => ({
  PushService: class {
    async sendPush(): Promise<void> {
      // no-op
    }
  },
}));

import { VoiceAssistantWebSocketServer } from "./websocket-server.js";

interface WebSocketServerInternals {
  attachAuthenticatedSocket(ws: unknown, req: unknown, password: string | undefined): Promise<void>;
}

const TEST_DAEMON_VERSION = "1.2.3-test";

class MockSocket {
  readyState = 1;
  bufferedAmount = 0;
  sent: unknown[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  private listeners = new Map<string, SocketListener[]>();

  on(event: "message" | "close" | "error", listener: SocketListener): void {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(listener);
    this.listeners.set(event, handlers);
  }

  once(event: "close" | "error", listener: SocketListener): void {
    const wrapped: SocketListener = (...args) => {
      this.off(event, wrapped);
      listener(...args);
    };
    this.on(event, wrapped);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
    this.emit("close", code ?? 1000, reason ?? "");
  }

  emit(event: "message" | "close" | "error", ...args: unknown[]): void {
    const handlers = this.listeners.get(event) ?? [];
    for (const handler of handlers.slice()) {
      handler(...args);
    }
  }

  private off(event: "close" | "error", listener: SocketListener): void {
    const handlers = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      handlers.filter((handler) => handler !== listener),
    );
  }
}

function createLogger() {
  const logger = {
    child: vi.fn(() => logger),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger;
}

function createServer(auth?: { password: string }) {
  const daemonConfigStore = {
    onChange: vi.fn(() => () => {}),
  };
  return new VoiceAssistantWebSocketServer(
    createStub<HTTPServer>({}),
    createStub<pino.Logger>(createLogger()),
    "srv_test",
    createStub<AgentManager>({
      setAgentAttentionCallback: vi.fn(),
      getAgent: vi.fn(() => null),
      getMetricsSnapshot: vi.fn(() => ({
        totalAgents: 0,
        idleAgents: 0,
        runningAgents: 0,
        pendingPermissionAgents: 0,
        erroredAgents: 0,
      })),
    }),
    createStub<AgentStorage>({}),
    createStub<DownloadTokenStore>({}),
    "/tmp/paseo-test",
    createStub<DaemonConfigStore>(daemonConfigStore),
    null,
    { allowedOrigins: new Set() },
    auth,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    TEST_DAEMON_VERSION,
    undefined,
    undefined,
    undefined,
    createStub<FileBackedChatService>({}),
    createStub<LoopService>({}),
    createStub<ScheduleService>({}),
    createStub<CheckoutDiffManager>({
      subscribe: vi.fn(),
      scheduleRefreshForCwd: vi.fn(),
      getMetrics: vi.fn(() => ({
        checkoutDiffTargetCount: 0,
        checkoutDiffSubscriptionCount: 0,
        checkoutDiffWatcherCount: 0,
        checkoutDiffFallbackRefreshTargetCount: 0,
      })),
      dispose: vi.fn(),
    }),
  );
}

describe("WebSocket auth upgrade uses async bcrypt", () => {
  beforeEach(() => {
    wsModuleMock.MockWebSocketServer.instances.length = 0;
    sessionMock.instances.length = 0;
    authModule.isBearerTokenValidAsync.mockClear();
    authModule.isBearerTokenValid.mockClear();
  });

  afterEach(async () => {
    wsModuleMock.MockWebSocketServer.instances.length = 0;
    sessionMock.instances.length = 0;
  });

  test("calls isBearerTokenValidAsync (not sync) when password is set", async () => {
    const password = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";
    const server = createServer({ password });
    const internals = asInternals<WebSocketServerInternals>(server);
    const ws = new MockSocket();

    authModule.isBearerTokenValidAsync.mockResolvedValueOnce(true);

    await internals.attachAuthenticatedSocket(
      ws,
      { headers: { "sec-websocket-protocol": "paseo.bearer.correct-password" } },
      password,
    );

    expect(authModule.isBearerTokenValidAsync).toHaveBeenCalledWith({
      password,
      token: "test-token",
    });
    expect(authModule.isBearerTokenValid).not.toHaveBeenCalled();

    await server.close();
  });

  test("closes socket with 4401 when async auth rejects", async () => {
    const password = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";
    const server = createServer({ password });
    const internals = asInternals<WebSocketServerInternals>(server);
    const ws = new MockSocket();

    authModule.isBearerTokenValidAsync.mockResolvedValueOnce(false);

    await internals.attachAuthenticatedSocket(
      ws,
      { headers: { "sec-websocket-protocol": "paseo.bearer.wrong" } },
      password,
    );

    expect(ws.closedWith).not.toBeNull();
    expect(ws.closedWith!.code).toBe(4401);

    await server.close();
  });

  test("skips auth entirely when no password configured", async () => {
    const server = createServer();
    const internals = asInternals<WebSocketServerInternals>(server);
    const ws = new MockSocket();

    await internals.attachAuthenticatedSocket(ws, { headers: {} }, undefined);

    expect(authModule.isBearerTokenValidAsync).not.toHaveBeenCalled();
    expect(authModule.isBearerTokenValid).not.toHaveBeenCalled();

    await server.close();
  });
});
