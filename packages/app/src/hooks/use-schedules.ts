import type { DaemonClient } from "@server/client/daemon-client";
import type { ScheduleSummary, ScheduleStatus } from "@server/server/schedule/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

function schedulesQueryKey(serverId: string | null) {
  return ["schedules", serverId] as const;
}

async function fetchSchedules(client: DaemonClient): Promise<ScheduleSummary[]> {
  const payload = await client.scheduleList();
  return payload.schedules;
}

export function useSchedules(options: { serverId?: string | null }) {
  const serverId = useMemo(() => {
    const value = options.serverId;
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }, [options.serverId]);

  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const queryKey = useMemo(() => schedulesQueryKey(serverId), [serverId]);

  const query = useQuery({
    queryKey,
    queryFn: () => {
      if (!client) {
        throw new Error("Not connected");
      }
      return fetchSchedules(client);
    },
    enabled: !!client && isConnected && serverId !== null,
    refetchInterval: 15_000,
  });

  return {
    schedules: query.data ?? [],
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
    error: query.error,
  };
}

export function useScheduleActions(serverId: string) {
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => schedulesQueryKey(serverId), [serverId]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const pauseMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!client) {
        throw new Error("Not connected");
      }
      return client.schedulePause({ id });
    },
    onSuccess: invalidate,
  });

  const resumeMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!client) {
        throw new Error("Not connected");
      }
      return client.scheduleResume({ id });
    },
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!client) {
        throw new Error("Not connected");
      }
      return client.scheduleDelete({ id });
    },
    onSuccess: invalidate,
  });

  const runOnceMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!client) {
        throw new Error("Not connected");
      }
      return client.scheduleRunOnce({ id });
    },
    onSuccess: invalidate,
  });

  return {
    pause: pauseMutation.mutate,
    resume: resumeMutation.mutate,
    remove: deleteMutation.mutate,
    runOnce: runOnceMutation.mutate,
    isPending:
      pauseMutation.isPending ||
      resumeMutation.isPending ||
      deleteMutation.isPending ||
      runOnceMutation.isPending,
  };
}

export function formatCadence(cadence: ScheduleSummary["cadence"]): string {
  if (cadence.type === "cron") {
    return `cron: ${cadence.expression}`;
  }
  const ms = cadence.everyMs;
  if (ms < 60_000) {
    return `every ${Math.round(ms / 1_000)}s`;
  }
  if (ms < 3_600_000) {
    return `every ${Math.round(ms / 60_000)}m`;
  }
  if (ms < 86_400_000) {
    const hours = Math.round(ms / 3_600_000);
    return `every ${hours}h`;
  }
  const days = Math.round(ms / 86_400_000);
  return `every ${days}d`;
}

export function statusVariant(status: ScheduleStatus): "success" | "error" | "muted" {
  if (status === "active") {
    return "success";
  }
  if (status === "paused") {
    return "muted";
  }
  return "error";
}
