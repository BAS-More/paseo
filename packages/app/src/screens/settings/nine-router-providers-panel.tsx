import React from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import {
  useNineRouterProviders,
  type NineRouterProviderConnection,
} from "@/hooks/use-nine-router-providers";
import { SettingsSection } from "@/screens/settings/settings-section";

export interface NineRouterProvidersPanelProps {
  serverId: string | null;
}

function getDotStyle(status: string | undefined) {
  if (status === "active") return styles.dotActive;
  if (status === "error") return styles.dotError;
  return styles.dotUnknown;
}

function StatusDot({ status }: { status: string | undefined }) {
  return <View style={getDotStyle(status)} />;
}

function ProviderRow({ item }: { item: NineRouterProviderConnection }) {
  const isExpired = item.expiresAt && new Date(item.expiresAt).getTime() < Date.now();

  return (
    <View style={styles.providerRow}>
      <View style={styles.providerLeft}>
        <StatusDot status={item.testStatus} />
        <View style={styles.providerInfo}>
          <Text style={styles.providerName}>{item.name}</Text>
          <Text style={styles.providerMeta}>
            {item.provider} · {item.authType}
            {item.priority > 1 ? ` · priority ${item.priority}` : ""}
          </Text>
        </View>
      </View>
      <View style={styles.providerRight}>
        {isExpired && <Text style={styles.expiredBadge}>expired</Text>}
        {!isExpired && item.testStatus && <Text style={styles.statusText}>{item.testStatus}</Text>}
      </View>
    </View>
  );
}

export function NineRouterProvidersPanel({ serverId }: NineRouterProvidersPanelProps) {
  const { providers, isLoading } = useNineRouterProviders(serverId);

  if (!serverId) return null;

  // Group by provider name
  const grouped = providers.reduce<Record<string, NineRouterProviderConnection[]>>((acc, p) => {
    const key = p.provider;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  return (
    <SettingsSection title="Provider Connections">
      <View style={settingsStyles.card}>
        {isLoading && (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        )}
        {!isLoading && providers.length === 0 && (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyText}>No provider connections</Text>
          </View>
        )}
        {!isLoading &&
          providers.length > 0 &&
          Object.entries(grouped).map(([provider, connections]) => (
            <View key={provider}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>{provider}</Text>
                <Text style={styles.groupCount}>{connections.length}</Text>
              </View>
              {connections.map((conn) => (
                <ProviderRow key={conn.id} item={conn} />
              ))}
            </View>
          ))}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  providerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  providerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    flex: 1,
  },
  providerInfo: {
    flex: 1,
    gap: 2,
  },
  providerName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  providerMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  providerRight: {
    alignItems: "flex-end",
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  expiredBadge: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  dotActive: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.statusSuccess,
  },
  dotError: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.statusDanger,
  },
  dotUnknown: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.foregroundMuted,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  groupTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    textTransform: "capitalize",
  },
  groupCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  centered: {
    padding: theme.spacing[6],
    alignItems: "center",
  },
  emptyRow: {
    padding: theme.spacing[4],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
