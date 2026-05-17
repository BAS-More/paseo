import { memo, useCallback, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ChevronDown, ChevronUp, Plus, Settings, Zap } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

interface SidebarQuickActionsProps {
  onNewSession: () => void;
  onRoutines?: () => void;
  onCustomize?: () => void;
}

export const SidebarQuickActions = memo(function SidebarQuickActions({
  onNewSession,
  onRoutines,
  onCustomize,
}: SidebarQuickActionsProps) {
  const { theme } = useUnistyles();
  const [isExpanded, setIsExpanded] = useState(true);
  const toggleExpanded = useCallback(() => setIsExpanded((v) => !v), []);

  return (
    <View style={styles.container}>
      <QuickActionRow
        icon={Plus}
        label="New session"
        onPress={onNewSession}
        testID="sidebar-new-session"
      />
      {isExpanded ? (
        <>
          <QuickActionRow
            icon={Zap}
            label="Routines"
            onPress={onRoutines}
            testID="sidebar-routines"
          />
          <QuickActionRow
            icon={Settings}
            label="Customize"
            onPress={onCustomize}
            testID="sidebar-customize"
          />
        </>
      ) : null}
      <Pressable
        style={styles.moreRow}
        onPress={toggleExpanded}
        accessibilityLabel={isExpanded ? "Show less" : "Show more"}
      >
        {isExpanded ? (
          <ChevronUp size={14} color={theme.colors.foregroundMuted} />
        ) : (
          <ChevronDown size={14} color={theme.colors.foregroundMuted} />
        )}
        <Text style={styles.moreText}>{isExpanded ? "Less" : "More"}</Text>
      </Pressable>
    </View>
  );
});

function QuickActionRow({
  icon: Icon,
  label,
  onPress,
  testID,
}: {
  icon: typeof Plus;
  label: string;
  onPress?: () => void;
  testID?: string;
}) {
  const { theme } = useUnistyles();
  const pressableStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.actionRow,
      Boolean(hovered) && styles.actionRowHovered,
    ],
    [],
  );

  return (
    <Pressable
      style={pressableStyle}
      onPress={onPress}
      testID={testID}
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      <Icon size={14} color={theme.colors.foregroundMuted} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
  actionRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  actionLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  moreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  moreText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
}));
