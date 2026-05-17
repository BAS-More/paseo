import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

export type ServiceStatus = "running" | "stopped" | "error";

export interface StackServiceEntry {
  id: string;
  name: string;
  port: number;
  status: ServiceStatus;
  latencyMs?: number;
  error?: string;
}

export interface UseStackServicesResult {
  services: StackServiceEntry[] | undefined;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useStackServices(serverId: string | null): UseStackServicesResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["stack-services", serverId],
    queryFn: async () => {
      if (!client) throw new Error("Not connected");
      const result = await client.getStackServices();
      return result.services;
    },
    enabled: Boolean(serverId) && Boolean(client),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["stack-services", serverId] });
  }, [queryClient, serverId]);

  return {
    services: data,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refresh,
  };
}
