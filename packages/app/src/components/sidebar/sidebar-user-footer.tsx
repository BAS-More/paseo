import { memo, useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

interface SidebarUserFooterProps {
  userName: string;
  modelLabel: string;
  onPress?: () => void;
}

export const SidebarUserFooter = memo(function SidebarUserFooter({
  userName,
  modelLabel,
  onPress,
}: SidebarUserFooterProps) {
  const { theme } = useUnistyles();

  const pressableStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.container,
      Boolean(hovered) && styles.containerHovered,
    ],
    [],
  );

  return (
    <Pressable style={pressableStyle} onPress={onPress} accessibilityLabel="User and model">
      <View style={styles.avatarCircle}>
        <Text style={styles.avatarText}>{userName.charAt(0).toUpperCase()}</Text>
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {userName} · {modelLabel}
      </Text>
      <ChevronDown size={14} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  containerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  avatarCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.palette.blue[500],
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 11,
    fontWeight: theme.fontWeight.semibold,
    color: "#ffffff",
  },
  label: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    minWidth: 0,
  },
}));
