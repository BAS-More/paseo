import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useNineRouterStatus, type NineRouterStatus } from "@/hooks/use-nine-router-status";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { isWeb } from "@/constants/platform";
import { SettingsSection } from "@/screens/settings/settings-section";
import { NineRouterKeyManager } from "@/screens/settings/nine-router-key-manager";
import { NineRouterProvidersPanel } from "@/screens/settings/nine-router-providers-panel";
import { NineRouterUsagePanel } from "@/screens/settings/nine-router-usage-panel";
import { NineRouterOAuthPanel } from "@/screens/settings/nine-router-oauth-panel";
import { NineRouterModelAliasesPanel } from "@/screens/settings/nine-router-model-aliases-panel";

export interface NineRouterSectionProps {
  serverId: string | null;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function UsageStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.usageStat}>
      <Text style={styles.usageValue}>{value}</Text>
      <Text style={styles.usageLabel}>{label}</Text>
    </View>
  );
}

function AccountRow({
  account,
}: {
  account: { id: string; name: string; provider: string; status: string };
}) {
  return (
    <View style={styles.accountRow}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{account.name}</Text>
        <Text style={settingsStyles.rowHint}>{account.provider}</Text>
      </View>
      <Text style={styles.statusBadge}>{account.status}</Text>
    </View>
  );
}

function StatusContent({ status }: { status: NineRouterStatus }) {
  const dotStyle = status.reachable ? styles.dotConnected : styles.dotDisconnected;

  return (
    <>
      <View style={settingsStyles.row}>
        <View style={styles.statusIndicatorRow}>
          <View style={dotStyle} />
          <Text style={settingsStyles.rowTitle}>
            {status.reachable ? "Connected" : "Not connected"}
          </Text>
        </View>
      </View>

      {status.reachable && status.accounts.length > 0 ? (
        <>
          <View style={styles.borderedRow}>
            <Text style={styles.subheading}>Accounts</Text>
          </View>
          {status.accounts.map((account) => (
            <AccountRow key={account.id} account={account} />
          ))}
        </>
      ) : null}

      {status.reachable ? (
        <>
          <View style={styles.borderedRow}>
            <Text style={styles.subheading}>Usage</Text>
          </View>
          <View style={styles.borderedRow}>
            <View style={styles.usageGrid}>
              <UsageStat value={formatNumber(status.usage.totalRequests)} label="Requests" />
              <UsageStat value={formatNumber(status.usage.totalTokens)} label="Tokens" />
              <UsageStat value={formatCost(status.usage.totalCost)} label="Cost" />
            </View>
          </View>
        </>
      ) : null}
    </>
  );
}

function CardContent({
  status,
  isLoading,
  error,
}: {
  status: NineRouterStatus | undefined;
  isLoading: boolean;
  error: string | null;
}) {
  if (isLoading) {
    return (
      <View style={styles.statusRow} testID="nine-router-loading">
        <ActivityIndicator />
        <Text style={styles.mutedText}>Checking 9Router...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.statusRow}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (status) {
    return <StatusContent status={status} />;
  }

  return null;
}

function UrlConfigRow({ serverId }: { serverId: string }) {
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const savedUrl = (config?.nineRouter as Record<string, unknown> | undefined)?.url as
    | string
    | undefined;
  const displayValue = draft ?? savedUrl ?? "";
  const hasChanges = draft !== null && draft !== (savedUrl ?? "");

  const handleSave = useCallback(() => {
    if (!hasChanges || saving || draft === null) return;
    setSaving(true);
    void patchConfig({ nineRouter: { url: draft || undefined } })
      .then(() => setDraft(null))
      .finally(() => setSaving(false));
  }, [hasChanges, saving, draft, patchConfig]);

  const inputStyle = useMemo(
    () => [styles.urlInput, isWeb && { outlineStyle: "none" as const }],
    [],
  );

  return (
    <View style={styles.urlRow}>
      <Text style={settingsStyles.rowTitle}>URL</Text>
      <View style={styles.urlInputRow}>
        <AdaptiveTextInput
          value={displayValue}
          onChangeText={setDraft}
          placeholder="http://localhost:20128 (default)"
          autoCapitalize="none"
          autoCorrect={false}
          // @ts-expect-error — outlineStyle is web-only
          style={inputStyle}
        />
        {hasChanges ? (
          <Button
            variant="default"
            size="sm"
            onPress={handleSave}
            disabled={saving}
            accessibilityLabel="Save 9Router URL"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

export function NineRouterSection({ serverId }: NineRouterSectionProps) {
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const { status, isLoading, error } = useNineRouterStatus(serverId);

  if (!serverId || !isConnected) {
    return null;
  }

  return (
    <>
      <SettingsSection title="9Router">
        <View style={settingsStyles.card}>
          <CardContent status={status} isLoading={isLoading} error={error} />
          <UrlConfigRow serverId={serverId} />
        </View>
      </SettingsSection>
      {status?.reachable ? (
        <>
          <NineRouterUsagePanel serverId={serverId} />
          <NineRouterKeyManager serverId={serverId} />
          <NineRouterProvidersPanel serverId={serverId} />
          <NineRouterModelAliasesPanel serverId={serverId} />
          <NineRouterOAuthPanel serverId={serverId} />
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  statusIndicatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  dotConnected: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.statusSuccess,
  },
  dotDisconnected: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.statusDanger,
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  subheading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  statusBadge: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  borderedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  usageGrid: {
    flexDirection: "row",
    flex: 1,
    justifyContent: "space-around",
  },
  usageStat: {
    alignItems: "center",
    gap: theme.spacing[1],
  },
  usageValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  usageLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  urlRow: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.spacing[1],
  },
  urlInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  urlInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
