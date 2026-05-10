import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import {
  useNineRouterUsage,
  type NineRouterUsageByProvider,
  type NineRouterUsageByModel,
} from "@/hooks/use-nine-router-usage";
import { SettingsSection } from "@/screens/settings/settings-section";

export interface NineRouterUsagePanelProps {
  serverId: string | null;
}

const PERIODS = ["24h", "7d", "30d"] as const;
type Period = (typeof PERIODS)[number];

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function PeriodButton({
  period,
  isActive,
  onPress,
}: {
  period: Period;
  isActive: boolean;
  onPress: (p: Period) => void;
}) {
  const handlePress = useCallback(() => onPress(period), [onPress, period]);
  const btnStyle = isActive ? styles.periodBtnActive : styles.periodBtn;
  const textStyle = isActive ? styles.periodTextActive : styles.periodText;
  return (
    <Pressable
      onPress={handlePress}
      style={btnStyle}
      accessibilityLabel={`Select period ${period}`}
      accessibilityRole="button"
    >
      <Text style={textStyle}>{period}</Text>
    </Pressable>
  );
}

function PeriodSelector({
  selected,
  onSelect,
}: {
  selected: Period;
  onSelect: (p: Period) => void;
}) {
  return (
    <View style={styles.periodRow}>
      {PERIODS.map((p) => (
        <PeriodButton key={p} period={p} isActive={selected === p} onPress={onSelect} />
      ))}
    </View>
  );
}

function UsageSummaryRow({
  totalRequests,
  totalTokens,
  totalCost,
}: {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
}) {
  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryItem}>
        <Text style={styles.summaryValue}>{formatNumber(totalRequests)}</Text>
        <Text style={styles.summaryLabel}>Requests</Text>
      </View>
      <View style={styles.summaryItem}>
        <Text style={styles.summaryValue}>{formatNumber(totalTokens)}</Text>
        <Text style={styles.summaryLabel}>Tokens</Text>
      </View>
      <View style={styles.summaryItem}>
        <Text style={styles.summaryValue}>{formatCost(totalCost)}</Text>
        <Text style={styles.summaryLabel}>Cost</Text>
      </View>
    </View>
  );
}

function CostBarSegment({ label, pct }: { label: string; pct: number }) {
  const segmentStyle = useMemo(() => ({ ...styles.costBarSegment, flex: pct }), [pct]);
  return (
    <View key={label} style={segmentStyle}>
      <View style={styles.costBarFill} />
    </View>
  );
}

function CostBar({
  items,
  total,
}: {
  items: Array<{ label: string; cost: number }>;
  total: number;
}) {
  if (total <= 0) return null;
  return (
    <View style={styles.costBarContainer}>
      <View style={styles.costBar}>
        {items.map((item) => {
          const pct = (item.cost / total) * 100;
          if (pct < 1) return null;
          return <CostBarSegment key={item.label} label={item.label} pct={pct} />;
        })}
      </View>
      <View style={styles.costBarLegend}>
        {items
          .filter((i) => i.cost > 0)
          .map((item) => (
            <Text key={item.label} style={styles.costBarLabel}>
              {item.label}: {formatCost(item.cost)}
            </Text>
          ))}
      </View>
    </View>
  );
}

function ProviderUsageList({ items }: { items: NineRouterUsageByProvider[] }) {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => b.cost - a.cost);
  return (
    <View style={styles.listSection}>
      <Text style={styles.listHeading}>By Provider</Text>
      {sorted.map((item) => (
        <View key={item.provider} style={styles.listRow}>
          <Text style={styles.listName}>{item.provider}</Text>
          <View style={styles.listStats}>
            <Text style={styles.listStat}>{formatNumber(item.requests)} req</Text>
            <Text style={styles.listCost}>{formatCost(item.cost)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function ModelUsageList({ items }: { items: NineRouterUsageByModel[] }) {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => b.requests - a.requests);
  return (
    <View style={styles.listSection}>
      <Text style={styles.listHeading}>By Model</Text>
      {sorted.map((item) => (
        <View key={item.model} style={styles.listRow}>
          <Text style={styles.listName}>{item.model}</Text>
          <View style={styles.listStats}>
            <Text style={styles.listStat}>{formatNumber(item.requests)} req</Text>
            <Text style={styles.listCost}>{formatCost(item.cost)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function NineRouterUsagePanel({ serverId }: NineRouterUsagePanelProps) {
  const [period, setPeriod] = useState<Period>("7d");
  const { usage, isLoading } = useNineRouterUsage(serverId, period);

  const handlePeriodChange = useCallback((p: Period) => {
    setPeriod(p);
  }, []);

  const costBarItems = useMemo(
    () => (usage?.byProvider ?? []).map((p) => ({ label: p.provider, cost: p.cost })),
    [usage?.byProvider],
  );

  if (!serverId) return null;

  return (
    <SettingsSection title="Usage Analytics">
      <View style={settingsStyles.card}>
        <View style={styles.headerRow}>
          <PeriodSelector selected={period} onSelect={handlePeriodChange} />
        </View>
        {isLoading && (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        )}
        {!isLoading && usage && (
          <>
            <UsageSummaryRow
              totalRequests={usage.totalRequests}
              totalTokens={usage.totalTokens}
              totalCost={usage.totalCost}
            />
            <CostBar items={costBarItems} total={usage.totalCost} />
            <ProviderUsageList items={usage.byProvider} />
            <ModelUsageList items={usage.byModel} />
          </>
        )}
        {!isLoading && !usage && (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyText}>No usage data available</Text>
          </View>
        )}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  headerRow: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  periodRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  periodBtn: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  periodBtnActive: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    backgroundColor: theme.colors.foreground,
    borderColor: theme.colors.foreground,
  },
  periodText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  periodTextActive: {
    color: theme.colors.background,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  summaryItem: {
    alignItems: "center",
    gap: theme.spacing[1],
  },
  summaryValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  summaryLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  costBarContainer: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  costBar: {
    flexDirection: "row",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: theme.colors.border,
  },
  costBarSegment: {
    overflow: "hidden",
  },
  costBarFill: {
    flex: 1,
    backgroundColor: theme.colors.foregroundMuted,
    borderRightWidth: 1,
    borderRightColor: theme.colors.background,
  },
  costBarLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  costBarLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  listSection: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  listHeading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    marginBottom: theme.spacing[1],
  },
  listRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: theme.spacing[1],
  },
  listName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flex: 1,
  },
  listStats: {
    flexDirection: "row",
    gap: theme.spacing[3],
    alignItems: "center",
  },
  listStat: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  listCost: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    minWidth: 50,
    textAlign: "right",
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
