import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

export interface CliToolSettings {
  tool: string;
  installed: boolean;
  has9Router: boolean;
  settings: Record<string, unknown>;
  settingsPath?: string;
}

export interface UseCliToolSettingsResult {
  data: CliToolSettings | undefined;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  update: (settings: Record<string, unknown>) => void;
  isUpdating: boolean;
  updateError: string | null;
}

export function useCliToolSettings(
  serverId: string | null,
  tool: string,
): UseCliToolSettingsResult {
  const client = useHostRuntimeClient(serverId ?? "");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["cli-tool-settings", serverId, tool],
    queryFn: async () => {
      if (!client) throw new Error("Not connected");
      const result = await client.getCliToolSettings(tool);
      return {
        tool: result.tool,
        installed: result.installed,
        has9Router: result.has9Router,
        settings: result.settings,
        settingsPath: result.settingsPath,
      } satisfies CliToolSettings;
    },
    enabled: Boolean(serverId) && Boolean(client) && Boolean(tool),
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async (settings: Record<string, unknown>) => {
      if (!client) throw new Error("Not connected");
      const result = await client.updateCliToolSettings(tool, settings);
      if (!result.success) {
        throw new Error(result.error ?? "Update failed");
      }
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cli-tool-settings", serverId, tool] });
    },
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["cli-tool-settings", serverId, tool] });
  }, [queryClient, serverId, tool]);

  const update = useCallback(
    (settings: Record<string, unknown>) => {
      mutation.mutate(settings);
    },
    [mutation],
  );

  return {
    data,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refresh,
    update,
    isUpdating: mutation.isPending,
    updateError: mutation.error instanceof Error ? mutation.error.message : null,
  };
}
