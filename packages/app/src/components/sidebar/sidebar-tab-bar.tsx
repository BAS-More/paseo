import { memo, useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export type SidebarTab = "chat" | "cowork" | "code";

interface SidebarTabBarProps {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
}

const TABS: { id: SidebarTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "cowork", label: "Cowork" },
  { id: "code", label: "Code" },
];

export const SidebarTabBar = memo(function SidebarTabBar({
  activeTab,
  onTabChange,
}: SidebarTabBarProps) {
  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        {TABS.map((tab) => (
          <TabButton
            key={tab.id}
            id={tab.id}
            label={tab.label}
            isActive={activeTab === tab.id}
            onPress={onTabChange}
          />
        ))}
      </View>
    </View>
  );
});

function TabButton({
  id,
  label,
  isActive,
  onPress,
}: {
  id: SidebarTab;
  label: string;
  isActive: boolean;
  onPress: (tab: SidebarTab) => void;
}) {
  const handlePress = useCallback(() => onPress(id), [onPress, id]);
  const accessibilityState = useMemo(() => ({ selected: isActive }), [isActive]);

  const pressableStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.tab,
      isActive && styles.tabActive,
      !isActive && Boolean(hovered) && styles.tabHovered,
    ],
    [isActive],
  );

  const textStyle = useMemo(() => [styles.tabText, isActive && styles.tabTextActive], [isActive]);

  return (
    <Pressable
      style={pressableStyle}
      onPress={handlePress}
      accessibilityRole="tab"
      accessibilityState={accessibilityState}
      accessibilityLabel={label}
    >
      {isActive && id === "code" ? (
        <View style={styles.diamondWrap}>
          <View style={styles.diamond} />
        </View>
      ) : null}
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  tabRow: {
    flexDirection: "row",
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    padding: 2,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
  },
  tabActive: {
    backgroundColor: theme.colors.surface2,
  },
  tabHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  tabText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  tabTextActive: {
    color: theme.colors.foreground,
  },
  diamondWrap: {
    width: 8,
    height: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  diamond: {
    width: 6,
    height: 6,
    backgroundColor: theme.colors.palette.amber[500],
    transform: [{ rotate: "45deg" }],
    borderRadius: 1,
  },
}));
