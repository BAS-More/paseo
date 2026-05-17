import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";

export interface NineRouterOAuthPanelProps {
  serverId: string | null;
}

const OAUTH_SOURCES = [
  { id: "cursor", name: "Cursor", description: "Import Claude/GPT tokens from Cursor IDE" },
  { id: "kiro", name: "Kiro", description: "Import tokens from Kiro AI" },
  { id: "iflow", name: "iFlow", description: "Import tokens from iFlow" },
] as const;

type ImportStatus = "idle" | "importing" | "success" | "error";

interface ImportState {
  status: ImportStatus;
  email?: string;
  error?: string;
}

const IDLE_STATE: ImportState = { status: "idle" };

function OAuthSourceRow({
  source,
  state,
  onImport,
}: {
  source: (typeof OAUTH_SOURCES)[number];
  state: ImportState;
  onImport: (provider: string) => void;
}) {
  const handleImport = useCallback(() => onImport(source.id), [onImport, source.id]);

  return (
    <View style={styles.sourceRow}>
      <View style={styles.sourceInfo}>
        <Text style={styles.sourceName}>{source.name}</Text>
        <Text style={styles.sourceDesc}>{source.description}</Text>
        {state.status === "success" && state.email && (
          <Text style={styles.successText}>Imported: {state.email}</Text>
        )}
        {state.status === "error" && state.error && (
          <Text style={styles.errorText}>{state.error}</Text>
        )}
      </View>
      <View style={styles.sourceAction}>
        {state.status === "importing" && <ActivityIndicator size="small" />}
        {state.status === "success" && <Text style={styles.checkmark}>✓</Text>}
        {(state.status === "idle" || state.status === "error") && (
          <Pressable
            onPress={handleImport}
            style={styles.importBtn}
            accessibilityLabel={`Import from ${source.name}`}
          >
            <Text style={styles.importBtnText}>Import</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function NineRouterOAuthPanel({ serverId }: NineRouterOAuthPanelProps) {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const [states, setStates] = useState<Record<string, ImportState>>({});

  const handleImport = useCallback(
    async (provider: string) => {
      if (!client || !isConnected) return;
      setStates((prev) => ({ ...prev, [provider]: { status: "importing" } }));
      try {
        const result = await client.importNineRouterOAuth(provider);
        if (result.success) {
          setStates((prev) => ({
            ...prev,
            [provider]: { status: "success", email: result.email },
          }));
        } else {
          setStates((prev) => ({
            ...prev,
            [provider]: { status: "error", error: result.error ?? "Import failed" },
          }));
        }
      } catch {
        setStates((prev) => ({
          ...prev,
          [provider]: { status: "error", error: "Connection failed" },
        }));
      }
    },
    [client, isConnected],
  );

  if (!serverId) return null;

  return (
    <SettingsSection title="OAuth Token Import">
      <View style={settingsStyles.card}>
        {OAUTH_SOURCES.map((source) => (
          <OAuthSourceRow
            key={source.id}
            source={source}
            state={states[source.id] ?? IDLE_STATE}
            onImport={handleImport}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  sourceInfo: {
    flex: 1,
    gap: 2,
  },
  sourceName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  sourceDesc: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  successText: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.xs,
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
  },
  sourceAction: {
    marginLeft: theme.spacing[3],
    alignItems: "center",
    justifyContent: "center",
    minWidth: 60,
  },
  importBtn: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  importBtnText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  checkmark: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
  },
}));
