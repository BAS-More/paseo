import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export interface NineRouterModel {
  provider: string;
  model: string;
  name: string;
  fullModel: string;
  alias: string;
}

export interface UseNineRouterModelsResult {
  models: NineRouterModel[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function nineRouterModelsQueryKey(serverId: string | null) {
  return ["nineRouterModels", serverId] as const;
}

export function useNineRouterModels(serverId: string | null): UseNineRouterModelsResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const queryClient = useQueryClient();

  const queryKey = useMemo(() => nineRouterModelsQueryKey(serverId), [serverId]);

  const query = useQuery({
    queryKey,
    enabled: Boolean(serverId && client && isConnected),
    staleTime: 5 * 60_000, // 5 min — models don't change often
    queryFn: async () => {
      if (!client) throw new Error("Host is not connected");
      const result = await client.getNineRouterModels();
      return result.models as NineRouterModel[];
    },
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  return {
    models: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh,
  };
}
