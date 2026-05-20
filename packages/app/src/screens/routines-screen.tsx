import { useCallback, useMemo } from "react";
import { FlatList, Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  ChevronLeft,
  Clock,
  MoreVertical,
  Pause,
  Play,
  RotateCw,
  Trash2,
} from "lucide-react-native";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatCadence,
  statusVariant,
  useScheduleActions,
  useSchedules,
} from "@/hooks/use-schedules";
import { buildHostRootRoute } from "@/utils/host-routes";
import type { ScheduleSummary } from "@server/server/schedule/types";

export function RoutinesScreen({ serverId }: { serverId: string }) {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <RoutinesScreenContent serverId={serverId} />;
}

function RoutinesScreenContent({ serverId }: { serverId: string }) {
  const { theme } = useUnistyles();
  const { schedules, isLoading, isRefetching, refetch } = useSchedules({ serverId });
  const actions = useScheduleActions(serverId);

  const sorted = useMemo(
    () =>
      [...schedules].sort((a, b) => {
        const statusOrder = { active: 0, paused: 1, completed: 2 };
        const aDiff = statusOrder[a.status] - statusOrder[b.status];
        if (aDiff !== 0) {
          return aDiff;
        }
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }),
    [schedules],
  );

  const handleBack = useCallback(() => {
    router.navigate(buildHostRootRoute(serverId));
  }, [serverId]);

  const renderItem = useCallback(
    ({ item }: { item: ScheduleSummary }) => <ScheduleRow schedule={item} actions={actions} />,
    [actions],
  );

  const keyExtractor = useCallback((item: ScheduleSummary) => item.id, []);

  return (
    <View style={styles.container}>
      <MenuHeader title="Routines" />
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <LoadingSpinner size="large" color={theme.colors.foregroundMuted} />
        </View>
      ) : null}
      {!isLoading && sorted.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Clock size={32} color={theme.colors.foregroundMuted} />
          <Text style={styles.emptyTitle}>No routines yet</Text>
          <Text style={styles.emptySubtext}>
            Use /schedule in a session to create recurring tasks
          </Text>
          <Button variant="ghost" leftIcon={ChevronLeft} onPress={handleBack}>
            Back
          </Button>
        </View>
      ) : null}
      {!isLoading && sorted.length > 0 ? (
        <FlatList
          data={sorted}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          refreshing={isRefetching}
          onRefresh={refetch}
        />
      ) : null}
    </View>
  );
}

function ScheduleRow({
  schedule,
  actions,
}: {
  schedule: ScheduleSummary;
  actions: ReturnType<typeof useScheduleActions>;
}) {
  const { theme } = useUnistyles();
  const cadenceLabel = formatCadence(schedule.cadence);
  const variant = statusVariant(schedule.status);
  const displayName = schedule.name ?? truncatePrompt(schedule.prompt, 60);

  const handlePause = useCallback(() => actions.pause(schedule.id), [actions, schedule.id]);
  const handleResume = useCallback(() => actions.resume(schedule.id), [actions, schedule.id]);
  const handleDelete = useCallback(() => actions.remove(schedule.id), [actions, schedule.id]);
  const handleRunOnce = useCallback(() => actions.runOnce(schedule.id), [actions, schedule.id]);

  const pauseIcon = useMemo(
    () => <Pause size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const playIcon = useMemo(
    () => <Play size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const rotateIcon = useMemo(
    () => <RotateCw size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const trashIcon = useMemo(
    () => <Trash2 size={14} color={theme.colors.palette.red[500]} />,
    [theme.colors.palette.red],
  );

  const nextRun = schedule.nextRunAt ? formatRelativeTime(schedule.nextRunAt) : null;
  const lastRun = schedule.lastRunAt ? formatRelativeTime(schedule.lastRunAt) : null;

  const pressableStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      Boolean(hovered) && styles.rowHovered,
    ],
    [],
  );

  return (
    <Pressable style={pressableStyle} accessibilityLabel={displayName}>
      <View style={styles.rowMain}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowName} numberOfLines={1}>
            {displayName}
          </Text>
          <StatusBadge label={schedule.status} variant={variant} />
        </View>
        <Text style={styles.rowPrompt} numberOfLines={2}>
          {schedule.prompt}
        </Text>
        <View style={styles.rowMeta}>
          <Text style={styles.rowMetaText}>{cadenceLabel}</Text>
          {nextRun && schedule.status === "active" ? (
            <Text style={styles.rowMetaText}>next: {nextRun}</Text>
          ) : null}
          {lastRun ? <Text style={styles.rowMetaText}>last: {lastRun}</Text> : null}
        </View>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger accessibilityLabel="Schedule actions">
          <MoreVertical size={16} color={theme.colors.foregroundMuted} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end">
          {schedule.status === "active" ? (
            <DropdownMenuItem onSelect={handlePause} leading={pauseIcon}>
              Pause
            </DropdownMenuItem>
          ) : null}
          {schedule.status === "paused" ? (
            <DropdownMenuItem onSelect={handleResume} leading={playIcon}>
              Resume
            </DropdownMenuItem>
          ) : null}
          {schedule.status !== "completed" ? (
            <DropdownMenuItem onSelect={handleRunOnce} leading={rotateIcon}>
              Run now
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={handleDelete} destructive leading={trashIcon}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Pressable>
  );
}

function truncatePrompt(prompt: string, maxLen: number): string {
  if (prompt.length <= maxLen) {
    return prompt;
  }
  return prompt.slice(0, maxLen - 1) + "…";
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const target = new Date(iso).getTime();
  const diffMs = target - now;
  const absDiff = Math.abs(diffMs);

  if (absDiff < 60_000) {
    return diffMs > 0 ? "in <1m" : "<1m ago";
  }
  if (absDiff < 3_600_000) {
    const m = Math.round(absDiff / 60_000);
    return diffMs > 0 ? `in ${m}m` : `${m}m ago`;
  }
  if (absDiff < 86_400_000) {
    const h = Math.round(absDiff / 3_600_000);
    return diffMs > 0 ? `in ${h}h` : `${h}h ago`;
  }
  const d = Math.round(absDiff / 86_400_000);
  return diffMs > 0 ? `in ${d}d` : `${d}d ago`;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[6],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
  },
  emptySubtext: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  list: {
    paddingVertical: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  rowMain: {
    flex: 1,
    gap: theme.spacing[1],
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rowName: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  rowPrompt: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    lineHeight: theme.fontSize.xs * 1.4,
  },
  rowMeta: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[1],
  },
  rowMetaText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
}));
