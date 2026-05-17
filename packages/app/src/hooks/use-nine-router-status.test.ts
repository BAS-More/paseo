/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNineRouterStatus } from "./use-nine-router-status";

const { mockClient, mockRuntime } = vi.hoisted(() => {
  const hoistedClient = {
    getNineRouterStatus: vi.fn(),
  };
  return {
    mockClient: hoistedClient,
    mockRuntime: {
      client: hoistedClient,
      isConnected: true,
    },
  };
});

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => mockRuntime.client,
  useHostRuntimeIsConnected: () => mockRuntime.isConnected,
}));

const serverId = "server-1";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function renderNineRouterHook() {
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return {
    queryClient,
    ...renderHook(() => useNineRouterStatus(serverId), { wrapper }),
  };
}

const MOCK_STATUS = {
  requestId: "req-1",
  reachable: true,
  accounts: [
    { id: "acc-1", name: "GPT-4", provider: "openai", status: "active" },
    { id: "acc-2", name: "Claude", provider: "anthropic", status: "active" },
  ],
  usage: {
    totalRequests: 100,
    totalTokens: 50000,
    totalCost: 1.5,
    byAccount: [{ id: "acc-1", requests: 100, tokens: 50000, cost: 1.5 }],
  },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("useNineRouterStatus", () => {
  it("returns loading state initially", () => {
    mockClient.getNineRouterStatus.mockReturnValue(new Promise(() => {}));
    const { result } = renderNineRouterHook();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.status).toBeUndefined();
  });

  it("returns status data on success", async () => {
    mockClient.getNineRouterStatus.mockResolvedValue(MOCK_STATUS);
    const { result } = renderNineRouterHook();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.status?.reachable).toBe(true);
    expect(result.current.status?.accounts).toHaveLength(2);
    expect(result.current.status?.usage.totalRequests).toBe(100);
  });

  it("returns error on failure", async () => {
    mockClient.getNineRouterStatus.mockRejectedValue(new Error("Connection refused"));
    const { result } = renderNineRouterHook();

    await waitFor(() => expect(result.current.error).toBe("Connection refused"));
  });

  it("does not fetch when disconnected", () => {
    mockRuntime.isConnected = false;
    renderNineRouterHook();
    expect(mockClient.getNineRouterStatus).not.toHaveBeenCalled();
    mockRuntime.isConnected = true;
  });

  it("does not fetch without serverId", () => {
    const queryClient = createQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    renderHook(() => useNineRouterStatus(null), { wrapper });
    expect(mockClient.getNineRouterStatus).not.toHaveBeenCalled();
  });

  it("exposes refresh function that refetches", async () => {
    mockClient.getNineRouterStatus.mockResolvedValue(MOCK_STATUS);
    const { result } = renderNineRouterHook();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const callCount = mockClient.getNineRouterStatus.mock.calls.length;

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockClient.getNineRouterStatus.mock.calls.length).toBeGreaterThan(callCount);
  });

  it("returns unreachable status correctly", async () => {
    mockClient.getNineRouterStatus.mockResolvedValue({
      ...MOCK_STATUS,
      reachable: false,
      accounts: [],
      usage: { totalRequests: 0, totalTokens: 0, totalCost: 0, byAccount: [] },
    });
    const { result } = renderNineRouterHook();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.status?.reachable).toBe(false);
    expect(result.current.status?.accounts).toHaveLength(0);
  });
});
