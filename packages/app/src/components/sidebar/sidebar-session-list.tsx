import { memo, useCallback, useMemo } from "react";
import { FlatList, RefreshControl, Text, View, type ListRenderItem } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { usePinnedWorkspacesStore } from "@/stores/pinned-workspaces-store";
import { SidebarSessionRow } from "./sidebar-session-row";

interface SidebarSessionListProps {
  agents: AggregatedAgent[];
  selectedAgentKey: string | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  onSessionPress: (agent: AggregatedAgent) => void;
  onSessionLongPress?: (agent: AggregatedAgent) => void;
  onEndReached?: () => void;
  searchQuery?: string;
}

type ListItem =
  | { type: "section-header"; key: string; title: string }
  | { type: "session"; key: string; agent: AggregatedAgent };

export const SidebarSessionList = memo(function SidebarSessionList({
  agents,
  selectedAgentKey,
  isRefreshing,
  onRefresh,
  onSessionPress,
  onSessionLongPress,
  onEndReached,
  searchQuery,
}: SidebarSessionListProps) {
  const { theme } = useUnistyles();
  const pinnedKeys = usePinnedWorkspacesStore((s) => s.pinnedKeys);

  const filteredAgents = useMemo(() => {
    if (!searchQuery?.trim()) return agents;
    const q = searchQuery.toLowerCase();
    return agents.filter(
      (a) => a.title?.toLowerCase().includes(q) || a.cwd?.toLowerCase().includes(q),
    );
  }, [agents, searchQuery]);

  const listData = useMemo(() => {
    const items: ListItem[] = [];
    const pinned: AggregatedAgent[] = [];
    const unpinned: AggregatedAgent[] = [];

    for (const agent of filteredAgents) {
      const agentKey = `${agent.serverId}:${agent.id}`;
      if (pinnedKeys.has(agentKey)) {
        pinned.push(agent);
      } else {
        unpinned.push(agent);
      }
    }

    if (pinned.length > 0) {
      items.push({ type: "section-header", key: "header-pinned", title: "Pinned" });
      for (const agent of pinned) {
        items.push({ type: "session", key: `${agent.serverId}:${agent.id}`, agent });
      }
    }

    const grouped = groupByDate(unpinned);
    for (const group of grouped) {
      items.push({
        type: "section-header",
        key: `header-${group.label}`,
        title: group.label,
      });
      for (const agent of group.agents) {
        items.push({ type: "session", key: `${agent.serverId}:${agent.id}`, agent });
      }
    }

    return items;
  }, [filteredAgents, pinnedKeys]);

  const renderItem: ListRenderItem<ListItem> = useCallback(
    ({ item }) => {
      if (item.type === "section-header") {
        return <SectionHeader title={item.title} />;
      }
      const agentKey = `${item.agent.serverId}:${item.agent.id}`;
      return (
        <SidebarSessionRow
          agent={item.agent}
          isSelected={selectedAgentKey === agentKey}
          isPinned={pinnedKeys.has(agentKey)}
          onPress={onSessionPress}
          onLongPress={onSessionLongPress}
        />
      );
    },
    [selectedAgentKey, pinnedKeys, onSessionPress, onSessionLongPress],
  );

  const keyExtractor = useCallback((item: ListItem) => item.key, []);

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={isRefreshing}
        onRefresh={onRefresh}
        tintColor={theme.colors.foregroundMuted}
      />
    ),
    [isRefreshing, onRefresh, theme.colors.foregroundMuted],
  );

  return (
    <FlatList
      data={listData}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      refreshControl={refreshControl}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      style={styles.list}
      contentContainerStyle={styles.listContent}
    />
  );
});

const SectionHeader = memo(function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
    </View>
  );
});

interface DateGroup {
  label: string;
  agents: AggregatedAgent[];
}

function groupByDate(agents: AggregatedAgent[]): DateGroup[] {
  const groups = new Map<string, AggregatedAgent[]>();

  for (const agent of agents) {
    const label = deriveDateSectionLabel(agent.lastActivityAt);
    let list = groups.get(label);
    if (!list) {
      list = [];
      groups.set(label, list);
    }
    list.push(agent);
  }

  const result: DateGroup[] = [];
  for (const [label, groupAgents] of groups) {
    result.push({ label, agents: groupAgents });
  }
  return result;
}

function deriveDateSectionLabel(lastActivityAt: Date): string {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const activityStart = new Date(
    lastActivityAt.getFullYear(),
    lastActivityAt.getMonth(),
    lastActivityAt.getDate(),
  );

  if (activityStart.getTime() >= todayStart.getTime()) return "Today";
  if (activityStart.getTime() >= yesterdayStart.getTime()) return "Yesterday";

  const diffDays = Math.floor(
    (todayStart.getTime() - activityStart.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays <= 7) {
    return lastActivityAt.toLocaleDateString("en-US", { weekday: "long" });
  }

  return lastActivityAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const styles = StyleSheet.create((theme) => ({
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingBottom: theme.spacing[2],
  },
  sectionHeader: {
    paddingHorizontal: theme.spacing[4] + theme.spacing[1],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
  },
  sectionHeaderText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
}));
