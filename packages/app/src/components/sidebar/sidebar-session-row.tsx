import { memo, useCallback, useMemo, useState } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { Archive, Clipboard, Pin, PinOff } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  type ActionStatus,
} from "@/components/ui/context-menu";
import { usePinnedWorkspacesStore } from "@/stores/pinned-workspaces-store";
import { useArchiveAgent } from "@/hooks/use-archive-agent";

interface SidebarSessionRowProps {
  agent: AggregatedAgent;
  isSelected: boolean;
  isPinned: boolean;
  onPress: (agent: AggregatedAgent) => void;
  onLongPress?: (agent: AggregatedAgent) => void;
}

export const SidebarSessionRow = memo(function SidebarSessionRow(props: SidebarSessionRowProps) {
  return (
    <ContextMenu>
      <SidebarSessionRowContent {...props} />
    </ContextMenu>
  );
});

const SidebarSessionRowContent = memo(function SidebarSessionRowContent({
  agent,
  isSelected,
  isPinned,
  onPress,
  onLongPress,
}: SidebarSessionRowProps) {
  const { theme } = useUnistyles();
  const handlePress = useCallback(() => onPress(agent), [onPress, agent]);
  const handleLongPress = useCallback(() => onLongPress?.(agent), [onLongPress, agent]);

  const triggerStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean; open?: boolean }) => [
      styles.row,
      isSelected && styles.rowSelected,
      !isSelected && Boolean(hovered) && styles.rowHovered,
    ],
    [isSelected],
  );

  const titleStyle = useMemo(
    () => [styles.title, isSelected && styles.titleSelected],
    [isSelected],
  );

  const statusIcon = resolveStatusIcon(agent, theme);
  const agentKey = `${agent.serverId}:${agent.id}`;

  const togglePin = usePinnedWorkspacesStore((s) => s.togglePin);
  const { archiveAgent } = useArchiveAgent();
  const [archiveStatus, setArchiveStatus] = useState<ActionStatus>("idle");

  const handleTogglePin = useCallback(() => {
    togglePin(agentKey);
  }, [togglePin, agentKey]);

  const handleArchive = useCallback(() => {
    setArchiveStatus("pending");
    void archiveAgent({ serverId: agent.serverId, agentId: agent.id })
      .then(() => setArchiveStatus("success"))
      .catch(() => setArchiveStatus("idle"));
  }, [archiveAgent, agent.serverId, agent.id]);

  const handleCopyTitle = useCallback(() => {
    const title = agent.title || "New session";
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(title);
    }
  }, [agent.title]);

  const pinIcon = useMemo(
    () =>
      isPinned ? (
        <PinOff size={14} color={theme.colors.foregroundMuted} />
      ) : (
        <Pin size={14} color={theme.colors.foregroundMuted} />
      ),
    [isPinned, theme.colors.foregroundMuted],
  );
  const archiveIcon = useMemo(
    () => <Archive size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const clipboardIcon = useMemo(
    () => <Clipboard size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );

  return (
    <>
      <ContextMenuTrigger
        style={triggerStyle}
        onPress={handlePress}
        onLongPress={handleLongPress}
        enabledOnMobile
        testID={`sidebar-session-${agent.id}`}
      >
        <View style={styles.statusIconWrap}>{statusIcon}</View>
        <Text style={titleStyle} numberOfLines={1}>
          {agent.title || "New session"}
        </Text>
      </ContextMenuTrigger>
      <ContextMenuContent
        align="start"
        width={200}
        mobileMode="sheet"
        testID={`sidebar-session-context-${agent.id}`}
      >
        <ContextMenuItem
          onSelect={handleTogglePin}
          leading={pinIcon}
          testID={`sidebar-session-context-${agent.id}-pin`}
        >
          {isPinned ? "Unpin" : "Pin to top"}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={handleCopyTitle}
          leading={clipboardIcon}
          testID={`sidebar-session-context-${agent.id}-copy`}
        >
          Copy title
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={handleArchive}
          leading={archiveIcon}
          destructive
          status={archiveStatus}
          pendingLabel="Archiving…"
          successLabel="Archived"
          testID={`sidebar-session-context-${agent.id}-archive`}
        >
          Archive session
        </ContextMenuItem>
      </ContextMenuContent>
    </>
  );
});

type Theme = ReturnType<typeof useUnistyles>["theme"];

function resolveStatusIcon(agent: AggregatedAgent, theme: Theme) {
  const { status, requiresAttention, labels } = agent;

  if (labels?.type === "cowork") {
    return <StatusDot color={theme.colors.palette.purple[500]} filled />;
  }

  if (requiresAttention) {
    return <StatusDot color={theme.colors.palette.amber[500]} filled />;
  }

  switch (status) {
    case "running": {
      const isToolUse = labels?.activity === "tool_use";
      if (isToolUse) {
        return <WrenchIcon color={theme.colors.palette.amber[500]} />;
      }
      return <AnimatedDots color={theme.colors.foreground} />;
    }
    case "initializing":
      return <AnimatedDots color={theme.colors.foregroundMuted} />;
    case "error":
      return <StatusDot color={theme.colors.palette.red[500]} filled />;
    case "idle":
      return <StatusDot color={theme.colors.palette.blue[400]} filled />;
    case "closed":
    default:
      return <StatusDot color={theme.colors.foregroundMuted} filled={false} />;
  }
}

function StatusDot({ color, filled }: { color: string; filled: boolean }) {
  const dotStyle = useMemo(
    () => [
      styles.dot,
      filled ? { backgroundColor: color } : { borderWidth: 1.5, borderColor: color },
    ],
    [color, filled],
  );
  return <View style={dotStyle} />;
}

function WrenchIcon({ color }: { color: string }) {
  const textStyle = useMemo(() => [styles.iconText, { color }], [color]);
  return <Text style={textStyle}>{"\u{1F527}"}</Text>;
}

function AnimatedDots({ color }: { color: string }) {
  const textStyle = useMemo(() => [styles.dotsText, { color }], [color]);
  return <Text style={textStyle}>{"···"}</Text>;
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    marginHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    minHeight: 32,
  },
  rowSelected: {
    backgroundColor: theme.colors.surface2,
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  statusIconWrap: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  iconText: {
    fontSize: 12,
    lineHeight: 16,
  },
  dotsText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    letterSpacing: 1,
  },
  title: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    flexShrink: 1,
    minWidth: 0,
  },
  titleSelected: {
    fontWeight: theme.fontWeight.medium,
  },
}));
