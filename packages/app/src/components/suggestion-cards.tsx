import { memo, useCallback } from "react";
import { View, Text, Pressable, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Code, FileText, Lightbulb, MessageCircle } from "lucide-react-native";
import type { Theme } from "@/styles/theme";

interface Suggestion {
  icon: typeof Code;
  title: string;
  prompt: string;
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: Code,
    title: "Write code",
    prompt: "Help me write a function that...",
  },
  {
    icon: FileText,
    title: "Analyze a file",
    prompt: "Read and explain the code in...",
  },
  {
    icon: Lightbulb,
    title: "Debug an issue",
    prompt: "I'm getting an error when...",
  },
  {
    icon: MessageCircle,
    title: "Explain a concept",
    prompt: "Explain how... works in this codebase",
  },
];

interface SuggestionCardsProps {
  onSelectPrompt?: (prompt: string) => void;
}

export const SuggestionCards = memo(function SuggestionCards({
  onSelectPrompt,
}: SuggestionCardsProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>How can I help?</Text>
      <View style={styles.grid}>
        {SUGGESTIONS.map((suggestion) => (
          <SuggestionCard key={suggestion.title} suggestion={suggestion} onPress={onSelectPrompt} />
        ))}
      </View>
    </View>
  );
});

function cardPressableStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.card, hovered ? styles.cardHovered : null];
}

function SuggestionCard({
  suggestion,
  onPress,
}: {
  suggestion: Suggestion;
  onPress?: (prompt: string) => void;
}) {
  const handlePress = useCallback(() => onPress?.(suggestion.prompt), [onPress, suggestion.prompt]);
  const Icon = suggestion.icon;

  return (
    <Pressable onPress={handlePress} style={cardPressableStyle}>
      <Icon size={20} color={styles.iconColor.color} />
      <Text style={styles.cardTitle}>{suggestion.title}</Text>
      <Text style={styles.cardPrompt} numberOfLines={2}>
        {suggestion.prompt}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing[6],
  },
  heading: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    marginBottom: theme.spacing[6],
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    maxWidth: 600,
    justifyContent: "center",
  },
  card: {
    width: 260,
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  cardHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  cardTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  cardPrompt: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  iconColor: {
    color: theme.colors.primary,
  },
}));
