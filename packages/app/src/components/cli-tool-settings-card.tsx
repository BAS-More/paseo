import { useCallback, useMemo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { RefreshCw, CheckCircle2, XCircle, AlertCircle } from "lucide-react-native";
import { settingsStyles } from "@/styles/settings";
import { useCliToolSettings } from "@/hooks/use-cli-tool-settings";
import { SettingsSection } from "@/screens/settings/settings-section";

/** Map Paseo provider IDs to 9Router CLI tool slugs */
const PROVIDER_TO_TOOL: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  copilot: "copilot",
  occ: "openclaw",
  opencode: "opencode",
};

export interface CliToolSettingsCardProps {
  serverId: string | null;
  provider: string;
}

function getStatusIcon(installed: boolean, has9Router: boolean) {
  if (!installed) return "not-installed";
  if (has9Router) return "configured";
  return "not-configured";
}

export function CliToolSettingsCard({ serverId, provider }: CliToolSettingsCardProps) {
  const { theme } = useUnistyles();
  const tool = PROVIDER_TO_TOOL[provider] ?? provider;
  const { data, isLoading, refresh } = useCliToolSettings(serverId, tool);

  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  const statusIcon = useMemo(() => {
    if (!data) return "not-installed";
    return getStatusIcon(data.installed, data.has9Router);
  }, [data]);

  const trailing = useMemo(
    () => (
      <Pressable
        onPress={handleRefresh}
        disabled={isLoading}
        hitSlop={8}
        style={settingsStyles.sectionHeaderLink}
        accessibilityRole="button"
        accessibilityLabel="Refresh routing settings"
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        ) : (
          <RefreshCw size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
        )}
      </Pressable>
    ),
    [handleRefresh, isLoading, theme.colors.foregroundMuted, theme.iconSize.sm],
  );

  if (!serverId) return null;

  return (
    <SettingsSection title="9Router Routing" trailing={trailing}>
      <View style={settingsStyles.card}>
        {isLoading && !data ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" />
            <Text style={styles.mutedText}>Loading routing config...</Text>
          </View>
        ) : null}
        {data ? (
          <View style={styles.contentRow}>
            <View style={styles.statusRow}>
              <StatusBadge status={statusIcon} theme={theme} />
              <Text style={styles.toolName}>{tool}</Text>
            </View>
            {data.installed ? (
              <View style={styles.detailsColumn}>
                <DetailRow
                  label="9Router"
                  value={data.has9Router ? "Configured" : "Not configured"}
                />
                {data.settingsPath ? <DetailRow label="Path" value={data.settingsPath} /> : null}
                {data.settings.model ? (
                  <DetailRow label="Model" value={String(data.settings.model)} />
                ) : null}
              </View>
            ) : (
              <Text style={styles.mutedText}>CLI tool not installed</Text>
            )}
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}

function StatusBadge({
  status,
  theme,
}: {
  status: string;
  theme: ReturnType<typeof useUnistyles>["theme"];
}) {
  if (status === "configured") {
    return <CheckCircle2 size={16} color={theme.colors.statusSuccess} />;
  }
  if (status === "not-configured") {
    return <AlertCircle size={16} color={theme.colors.statusWarning} />;
  }
  return <XCircle size={16} color={theme.colors.statusDanger} />;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  contentRow: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  toolName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  detailsColumn: {
    gap: theme.spacing[1],
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  detailValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    maxWidth: "60%",
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
