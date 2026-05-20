/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCadence, statusVariant, useScheduleActions, useSchedules } from "./use-schedules";

const { mockClient } = vi.hoisted(() => {
  const hoistedClient = {
    scheduleList: vi.fn(),
    schedulePause: vi.fn(),
    scheduleResume: vi.fn(),
    scheduleDelete: vi.fn(),
    scheduleRunOnce: vi.fn(),
  };
  return { mockClient: hoistedClient };
});

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => mockClient,
  useHostRuntimeIsConnected: () => true,
}));

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function createWrapper() {
  const queryClient = createQueryClient();
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

const SCHEDULE_ACTIVE = {
  id: "sched-1",
  name: "Daily backup",
  prompt: "run backup",
  cadence: { type: "every" as const, everyMs: 86_400_000 },
  target: { type: "new-agent" as const, config: { provider: "claude", cwd: "/tmp" } },
  status: "active" as const,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  nextRunAt: "2026-01-02T00:00:00Z",
  lastRunAt: null,
  pausedAt: null,
  expiresAt: null,
  maxRuns: null,
};

const SCHEDULE_PAUSED = {
  ...SCHEDULE_ACTIVE,
  id: "sched-2",
  name: "Weekly report",
  status: "paused" as const,
  cadence: { type: "cron" as const, expression: "0 9 * * MON" },
  pausedAt: "2026-01-01T12:00:00Z",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSchedules", () => {
  it("returns schedules from daemon", async () => {
    mockClient.scheduleList.mockResolvedValue({
      schedules: [SCHEDULE_ACTIVE, SCHEDULE_PAUSED],
    });

    const { result } = renderHook(() => useSchedules({ serverId: "server-1" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.schedules).toHaveLength(2);
    expect(result.current.schedules[0]?.id).toBe("sched-1");
    expect(result.current.schedules[1]?.id).toBe("sched-2");
  });

  it("returns empty array when no schedules", async () => {
    mockClient.scheduleList.mockResolvedValue({ schedules: [] });

    const { result } = renderHook(() => useSchedules({ serverId: "server-1" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.schedules).toEqual([]);
  });

  it("does not fetch when serverId is empty", () => {
    const { result } = renderHook(() => useSchedules({ serverId: "" }), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(mockClient.scheduleList).not.toHaveBeenCalled();
  });
});

describe("useScheduleActions", () => {
  it("calls pause on daemon and invalidates", async () => {
    mockClient.schedulePause.mockResolvedValue({});
    mockClient.scheduleList.mockResolvedValue({ schedules: [] });

    const { result } = renderHook(() => useScheduleActions("server-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.pause("sched-1");
    });

    expect(mockClient.schedulePause).toHaveBeenCalledWith({ id: "sched-1" });
  });

  it("calls resume on daemon", async () => {
    mockClient.scheduleResume.mockResolvedValue({});
    mockClient.scheduleList.mockResolvedValue({ schedules: [] });

    const { result } = renderHook(() => useScheduleActions("server-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.resume("sched-2");
    });

    expect(mockClient.scheduleResume).toHaveBeenCalledWith({ id: "sched-2" });
  });

  it("calls delete on daemon", async () => {
    mockClient.scheduleDelete.mockResolvedValue({});
    mockClient.scheduleList.mockResolvedValue({ schedules: [] });

    const { result } = renderHook(() => useScheduleActions("server-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.remove("sched-1");
    });

    expect(mockClient.scheduleDelete).toHaveBeenCalledWith({ id: "sched-1" });
  });

  it("calls runOnce on daemon", async () => {
    mockClient.scheduleRunOnce.mockResolvedValue({});
    mockClient.scheduleList.mockResolvedValue({ schedules: [] });

    const { result } = renderHook(() => useScheduleActions("server-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.runOnce("sched-1");
    });

    expect(mockClient.scheduleRunOnce).toHaveBeenCalledWith({ id: "sched-1" });
  });
});

describe("formatCadence", () => {
  it("formats seconds", () => {
    expect(formatCadence({ type: "every", everyMs: 30_000 })).toBe("every 30s");
  });

  it("formats minutes", () => {
    expect(formatCadence({ type: "every", everyMs: 300_000 })).toBe("every 5m");
  });

  it("formats hours", () => {
    expect(formatCadence({ type: "every", everyMs: 3_600_000 })).toBe("every 1h");
  });

  it("formats days", () => {
    expect(formatCadence({ type: "every", everyMs: 86_400_000 })).toBe("every 1d");
  });

  it("formats cron expression", () => {
    expect(formatCadence({ type: "cron", expression: "0 9 * * MON" })).toBe("cron: 0 9 * * MON");
  });
});

describe("statusVariant", () => {
  it("maps active to success", () => {
    expect(statusVariant("active")).toBe("success");
  });

  it("maps paused to muted", () => {
    expect(statusVariant("paused")).toBe("muted");
  });

  it("maps completed to error", () => {
    expect(statusVariant("completed")).toBe("error");
  });
});
