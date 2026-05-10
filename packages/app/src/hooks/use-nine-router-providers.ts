import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export interface NineRouterProviderConnection {
  id: string;
  provider: string;
  authType: string;
  name: string;
  priority: number;
  isActive: boolean;
  testStatus?: string;
  email?: string;
  expiresAt?: string;
  lastUsedAt?: string;
  lastError?: string;
}

export interface UseNineRouterProvidersResult {
  providers: NineRouterProviderConnection[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function nineRouterProvidersQueryKey(serverId: string | null) {
  return ["nineRouterProviders", serverId] as const;
}

export function useNineRouterProviders(serverId: string | null): UseNineRouterProvidersResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const queryClient = useQueryClient();

  const queryKey = useMemo(() => nineRouterProvidersQueryKey(serverId), [serverId]);

  const query = useQuery({
    queryKey,
    enabled: Boolean(serverId && client && isConnected),
    staleTime: 30_000,
    queryFn: async () => {
      if (!client) throw new Error("Host is not connected");
      const result = await client.getNineRouterProviders();
      return result.providers as NineRouterProviderConnection[];
    },
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  return {
    providers: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh,
  };
}
