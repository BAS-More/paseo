import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

interface NineRouterAccount {
  id: string;
  name: string;
  provider: string;
  status: string;
}

interface NineRouterUsage {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byAccount: Array<{ id: string; requests: number; tokens: number; cost: number }>;
}

export interface NineRouterStatus {
  reachable: boolean;
  accounts: NineRouterAccount[];
  usage: NineRouterUsage;
}

export interface UseNineRouterStatusResult {
  status: NineRouterStatus | undefined;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function nineRouterQueryKey(serverId: string | null) {
  return ["nineRouterStatus", serverId] as const;
}

export function useNineRouterStatus(serverId: string | null): UseNineRouterStatusResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const queryClient = useQueryClient();

  const queryKey = useMemo(() => nineRouterQueryKey(serverId), [serverId]);

  const query = useQuery({
    queryKey,
    enabled: Boolean(serverId && client && isConnected),
    staleTime: 30_000,
    queryFn: async () => {
      if (!client) {
        throw new Error("Host is not connected");
      }
      const result = await client.getNineRouterStatus();
      return {
        reachable: result.reachable,
        accounts: result.accounts,
        usage: result.usage,
      } satisfies NineRouterStatus;
    },
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  return {
    status: query.data,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh,
  };
}
