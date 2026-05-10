import { useCallback, useMemo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { RotateCw } from "lucide-react-native";
import { settingsStyles } from "@/styles/settings";
import { useStackServices, type StackServiceEntry } from "@/hooks/use-stack-services";
import { SettingsSection } from "@/screens/settings/settings-section";

export interface StackServicesPanelProps {
  serverId: string | null;
}

function getDotColor(status: string, theme: ReturnType<typeof useUnistyles>["theme"]): string {
  if (status === "running") return theme.colors.statusSuccess;
  if (status === "error") return theme.colors.statusWarning;
  return theme.colors.statusDanger;
}

function ServiceRow({ service }: { service: StackServiceEntry }) {
  const { theme } = useUnistyles();
  const dotStyle = useMemo(
    () => [styles.dot, { backgroundColor: getDotColor(service.status, theme) }],
    [service.status, theme],
  );

  return (
    <View style={styles.serviceRow}>
      <View style={styles.serviceInfo}>
        <View style={styles.nameRow}>
          <View style={dotStyle} />
          <Text style={styles.serviceName}>{service.name}</Text>
        </View>
        <Text style={styles.servicePort}>:{service.port}</Text>
      </View>
      <Text style={styles.statusText}>
        {service.status === "running" && service.latencyMs != null
          ? `${service.latencyMs}ms`
          : service.status}
      </Text>
    </View>
  );
}

export function StackServicesPanel({ serverId }: StackServicesPanelProps) {
  const { theme } = useUnistyles();
  const { services, isLoading, refresh } = useStackServices(serverId);

  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  const trailing = useMemo(
    () => (
      <Pressable
        onPress={handleRefresh}
        disabled={isLoading}
        hitSlop={8}
        style={settingsStyles.sectionHeaderLink}
        accessibilityRole="button"
        accessibilityLabel={isLoading ? "Refreshing stack" : "Refresh stack services"}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        ) : (
          <RotateCw size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
        )}
      </Pressable>
    ),
    [handleRefresh, isLoading, theme.colors.foregroundMuted, theme.iconSize.sm],
  );

  if (!serverId) return null;

  return (
    <SettingsSection title="Stack Services" trailing={trailing}>
      <View style={settingsStyles.card}>
        {isLoading && !services ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" />
            <Text style={styles.mutedText}>Checking services...</Text>
          </View>
        ) : null}
        {services?.map((service) => (
          <ServiceRow key={service.id} service={service} />
        ))}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  serviceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  serviceInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  serviceName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  servicePort: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
