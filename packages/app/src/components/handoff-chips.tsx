import React, { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import type { Handoff } from "@/lib/spec-kit/handoffs";

// Renders a row of one-click follow-up chips after a slash-command turn.
//
// Each chip corresponds to one handoff entry parsed from a command
// markdown file's frontmatter (see `lib/spec-kit/handoffs.ts`). Pressing
// a chip calls `onSelect(handoff)`; the parent decides whether to
// populate the composer (`handoff.send !== true`) or send immediately
// (`handoff.send === true`).
//
// Visual language matches `PromptChip` in `agent-stream-view.tsx` —
// pill-shaped, border-on-surface, foreground text — so the chips look
// like a natural continuation of the existing suggested-prompt UI.

export interface HandoffChipsProps {
  handoffs: ReadonlyArray<Handoff>;
  onSelect: (handoff: Handoff) => void;
  testID?: string;
}

export function HandoffChips({ handoffs, onSelect, testID }: HandoffChipsProps) {
  if (handoffs.length === 0) return null;

  return (
    <View style={styles.row} testID={testID}>
      {handoffs.map((handoff) => (
        <HandoffChip
          key={`${handoff.agent}::${handoff.label}`}
          handoff={handoff}
          onPress={onSelect}
        />
      ))}
    </View>
  );
}

function HandoffChip({
  handoff,
  onPress,
}: {
  handoff: Handoff;
  onPress: (handoff: Handoff) => void;
}) {
  const handlePress = useCallback(() => onPress(handoff), [onPress, handoff]);
  return (
    <Pressable
      style={styles.chip}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={handoff.label}
      accessibilityHint={
        handoff.send ? "Sends the prompt immediately" : "Populates the composer with the prompt"
      }
    >
      <Text style={styles.chipText}>{handoff.label}</Text>
      {handoff.send ? <Text style={styles.chipBadge}>↵</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
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
  chipBadge: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
  },
}));
