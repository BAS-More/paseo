import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

export interface UseModelAliasesResult {
  aliases: Record<string, string> | undefined;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  setAlias: (alias: string, target: string) => void;
  deleteAlias: (alias: string) => void;
  testModel: (model: string) => void;
  isSettingAlias: boolean;
  isDeletingAlias: boolean;
  isTesting: boolean;
  testResult: { success: boolean; latencyMs: number; provider: string } | null;
  setAliasError: string | null;
  deleteAliasError: string | null;
  testError: string | null;
}

export function useModelAliases(serverId: string | null): UseModelAliasesResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["model-aliases", serverId],
    queryFn: async () => {
      if (!client) throw new Error("Not connected");
      const result = await client.getModelAliases();
      return result.aliases;
    },
    enabled: Boolean(serverId) && Boolean(client),
    staleTime: 30_000,
  });

  const setMutation = useMutation({
    mutationFn: async ({ alias, target }: { alias: string; target: string }) => {
      if (!client) throw new Error("Not connected");
      const result = await client.setModelAlias(alias, target);
      if (!result.success) {
        throw new Error(result.error ?? "Failed to set alias");
      }
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["model-aliases", serverId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (alias: string) => {
      if (!client) throw new Error("Not connected");
      const result = await client.deleteModelAlias(alias);
      if (!result.success) {
        throw new Error(result.error ?? "Failed to delete alias");
      }
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["model-aliases", serverId] });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (model: string) => {
      if (!client) throw new Error("Not connected");
      return client.testModel(model);
    },
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["model-aliases", serverId] });
  }, [queryClient, serverId]);

  const setAlias = useCallback(
    (alias: string, target: string) => {
      setMutation.mutate({ alias, target });
    },
    [setMutation],
  );

  const deleteAlias = useCallback(
    (alias: string) => {
      deleteMutation.mutate(alias);
    },
    [deleteMutation],
  );

  const testModelFn = useCallback(
    (model: string) => {
      testMutation.mutate(model);
    },
    [testMutation],
  );

  return {
    aliases: data,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refresh,
    setAlias,
    deleteAlias,
    testModel: testModelFn,
    isSettingAlias: setMutation.isPending,
    isDeletingAlias: deleteMutation.isPending,
    isTesting: testMutation.isPending,
    testResult: testMutation.data
      ? {
          success: testMutation.data.success,
          latencyMs: testMutation.data.latencyMs,
          provider: testMutation.data.provider,
        }
      : null,
    setAliasError: setMutation.error instanceof Error ? setMutation.error.message : null,
    deleteAliasError: deleteMutation.error instanceof Error ? deleteMutation.error.message : null,
    testError: testMutation.error instanceof Error ? testMutation.error.message : null,
  };
}
