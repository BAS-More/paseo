import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export interface NineRouterKey {
  id: string;
  name: string;
  key: string;
  machineId: string;
  isActive: boolean;
  createdAt: string;
}

export interface UseNineRouterKeysResult {
  keys: NineRouterKey[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createKey: (name: string) => Promise<void>;
  deleteKey: (id: string) => Promise<void>;
  isCreating: boolean;
  isDeleting: boolean;
}

function nineRouterKeysQueryKey(serverId: string | null) {
  return ["nineRouterKeys", serverId] as const;
}

export function useNineRouterKeys(serverId: string | null): UseNineRouterKeysResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const queryClient = useQueryClient();

  const queryKey = useMemo(() => nineRouterKeysQueryKey(serverId), [serverId]);

  const query = useQuery({
    queryKey,
    enabled: Boolean(serverId && client && isConnected),
    staleTime: 60_000,
    queryFn: async () => {
      if (!client) throw new Error("Host is not connected");
      const result = await client.getNineRouterKeys();
      return result.keys as NineRouterKey[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!client) throw new Error("Host is not connected");
      await client.createNineRouterKey(name);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!client) throw new Error("Host is not connected");
      await client.deleteNineRouterKey(id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  return {
    keys: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh,
    createKey: async (name: string) => {
      await createMutation.mutateAsync(name);
    },
    deleteKey: async (id: string) => {
      await deleteMutation.mutateAsync(id);
    },
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
