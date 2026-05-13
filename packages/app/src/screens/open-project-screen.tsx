import { useCallback, useEffect, useState } from "react";
import { Pressable, View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { FolderOpen, Smartphone, Sparkles } from "lucide-react-native";
import { PaseoLogo } from "@/components/icons/paseo-logo";
import { Button } from "@/components/ui/button";
import { MenuHeader } from "@/components/headers/menu-header";
import { useOpenProjectPicker } from "@/hooks/use-open-project-picker";
import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore } from "@/stores/session-store";
import { useHasWorkspaces } from "@/stores/session-store-hooks";
import {
  useIsCompactFormFactor,
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { useAppSettings } from "@/hooks/use-settings";

const CLAUDE_SUGGESTED_PROMPTS = [
  "Summarize this project",
  "Find and fix bugs",
  "Write tests for recent changes",
];

function ClaudePromptChip({
  prompt,
  onPress,
}: {
  prompt: string;
  onPress: (prompt: string) => void;
}) {
  const handlePress = useCallback(() => onPress(prompt), [onPress, prompt]);
  return (
    <Pressable
      style={claudeStyles.chip}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={prompt}
    >
      <Text style={claudeStyles.chipText}>{prompt}</Text>
    </Pressable>
  );
}

export function OpenProjectScreen({ serverId }: { serverId: string }) {
  const openDesktopAgentList = usePanelStore((s) => s.openDesktopAgentList);
  const openProjectPicker = useOpenProjectPicker(serverId);
  const hasHydrated = useSessionStore((s) => s.sessions[serverId]?.hasHydratedWorkspaces ?? false);
  const hasProjects = useHasWorkspaces(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const [isPairDeviceOpen, setIsPairDeviceOpen] = useState(false);
  const { settings: appSettings } = useAppSettings();
  const isClaudeDesktop = appSettings.layoutMode === "claude-desktop";

  const isCompactLayout = useIsCompactFormFactor();

  useEffect(() => {
    if (!isCompactLayout) {
      openDesktopAgentList();
    }
  }, [isCompactLayout, openDesktopAgentList]);

  const handleOpenPicker = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  const handleOpenPairDevice = useCallback(() => setIsPairDeviceOpen(true), []);
  const handleClosePairDevice = useCallback(() => setIsPairDeviceOpen(false), []);

  // no-op for now — chips are visual affordance, not wired to send
  const handleSuggestedPrompt = useCallback((_prompt: string) => {}, []);

  if (isClaudeDesktop) {
    return (
      <View style={styles.container}>
        <MenuHeader borderless />
        <View style={styles.content}>
          <TitlebarDragRegion />
          <View style={claudeStyles.welcomeAvatar}>
            <Sparkles size={28} color="#fff" />
          </View>
          <Text style={claudeStyles.welcomeTitle}>How can I help you today?</Text>
          <View style={claudeStyles.promptChips}>
            {CLAUDE_SUGGESTED_PROMPTS.map((prompt) => (
              <ClaudePromptChip key={prompt} prompt={prompt} onPress={handleSuggestedPrompt} />
            ))}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MenuHeader borderless />
      <View style={styles.content}>
        <TitlebarDragRegion />
        <View style={styles.logo}>
          <PaseoLogo size={56} />
        </View>
        <View style={styles.headingGroup}>
          <Text style={styles.heading}>What shall we build today?</Text>
          {hasHydrated && !hasProjects ? (
            <Text style={styles.subtitle}>
              Add a project folder to start running agents on your codebase
            </Text>
          ) : null}
        </View>
        <View style={styles.cta}>
          <Button
            variant="default"
            leftIcon={FolderOpen}
            onPress={handleOpenPicker}
            testID="open-project-submit"
          >
            Add a project
          </Button>
          {isLocalDaemon ? (
            <Button
              variant="outline"
              leftIcon={Smartphone}
              onPress={handleOpenPairDevice}
              testID="open-project-pair-device"
            >
              Pair device
            </Button>
          ) : null}
        </View>
      </View>
      <PairDeviceModal
        visible={isPairDeviceOpen}
        onClose={handleClosePairDevice}
        testID="open-project-pair-device-modal"
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    userSelect: "none",
  },
  content: {
    position: "relative",
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 0,
    padding: theme.spacing[6],
    paddingBottom: {
      xs: HEADER_INNER_HEIGHT_MOBILE + HEADER_TOP_PADDING_MOBILE + theme.spacing[6],
      md: HEADER_INNER_HEIGHT + theme.spacing[6],
    },
  },
  logo: {
    marginBottom: theme.spacing[8],
  },
  headingGroup: {
    alignItems: "center",
    gap: theme.spacing[3],
  },
  cta: {
    marginTop: theme.spacing[12],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  heading: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));

const claudeStyles = StyleSheet.create((theme) => ({
  welcomeAvatar: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing[4],
  },
  welcomeTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["2xl"],
    fontWeight: "500",
    textAlign: "center",
  },
  promptChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[4],
  },
  chip: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  chipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
