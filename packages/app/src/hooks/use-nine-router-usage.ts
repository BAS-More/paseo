import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export interface NineRouterUsageByProvider {
  provider: string;
  requests: number;
  tokens: number;
  cost: number;
}

export interface NineRouterUsageByModel {
  model: string;
  requests: number;
  tokens: number;
  cost: number;
}

export interface NineRouterUsageData {
  period: string;
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byProvider: NineRouterUsageByProvider[];
  byModel: NineRouterUsageByModel[];
}

export interface UseNineRouterUsageResult {
  usage: NineRouterUsageData | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function nineRouterUsageQueryKey(serverId: string | null, period: string) {
  return ["nineRouterUsage", serverId, period] as const;
}

export function useNineRouterUsage(
  serverId: string | null,
  period: string = "7d",
): UseNineRouterUsageResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const queryClient = useQueryClient();

  const queryKey = useMemo(() => nineRouterUsageQueryKey(serverId, period), [serverId, period]);

  const query = useQuery({
    queryKey,
    enabled: Boolean(serverId && client && isConnected),
    staleTime: 60_000,
    queryFn: async () => {
      if (!client) throw new Error("Host is not connected");
      const result = await client.getNineRouterUsage(period);
      return {
        period: result.period,
        totalRequests: result.totalRequests,
        totalTokens: result.totalTokens,
        totalCost: result.totalCost,
        byProvider: result.byProvider,
        byModel: result.byModel,
      } as NineRouterUsageData;
    },
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  return {
    usage: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh,
  };
}
