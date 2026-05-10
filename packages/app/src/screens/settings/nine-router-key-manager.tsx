import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Copy, Plus, Trash2 } from "lucide-react-native";
import { settingsStyles } from "@/styles/settings";
import { useNineRouterKeys, type NineRouterKey } from "@/hooks/use-nine-router-keys";
import { AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/screens/settings/settings-section";
import { isWeb } from "@/constants/platform";
import * as Clipboard from "expo-clipboard";

export interface NineRouterKeyManagerProps {
  serverId: string | null;
}

function KeyRow({
  item,
  onDelete,
  isDeleting,
}: {
  item: NineRouterKey;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(item.key);
  }, [item.key]);

  const handleDelete = useCallback(() => {
    onDelete(item.id);
  }, [onDelete, item.id]);

  const maskedKey = `${item.key.slice(0, 8)}...${item.key.slice(-6)}`;

  return (
    <View style={styles.keyRow}>
      <View style={styles.keyInfo}>
        <Text style={styles.keyName}>{item.name}</Text>
        <Text style={styles.keyValue}>{maskedKey}</Text>
      </View>
      <View style={styles.keyActions}>
        <Pressable
          onPress={handleCopy}
          accessibilityLabel={`Copy key ${item.name}`}
          style={styles.iconBtn}
        >
          <Copy size={14} color={styles.iconColor.color} />
        </Pressable>
        <Pressable
          onPress={handleDelete}
          disabled={isDeleting}
          accessibilityLabel={`Delete key ${item.name}`}
          style={styles.iconBtn}
        >
          <Trash2 size={14} color={styles.dangerColor.color} />
        </Pressable>
      </View>
    </View>
  );
}

function CreateKeyRow({
  onCreate,
  isCreating,
}: {
  onCreate: (name: string) => void;
  isCreating: boolean;
}) {
  const [name, setName] = useState("");

  const handleCreate = useCallback(() => {
    if (!name.trim()) return;
    onCreate(name.trim());
    setName("");
  }, [name, onCreate]);

  return (
    <View style={styles.createRow}>
      <AdaptiveTextInput
        value={name}
        onChangeText={setName}
        placeholder="New key name"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.createInput}
        onSubmitEditing={handleCreate}
      />
      <Button
        variant="default"
        size="sm"
        onPress={handleCreate}
        disabled={isCreating || !name.trim()}
        accessibilityLabel="Create API key"
      >
        {isCreating ? <ActivityIndicator size="small" /> : <Plus size={14} color="#fff" />}
      </Button>
    </View>
  );
}

export function NineRouterKeyManager({ serverId }: NineRouterKeyManagerProps) {
  const { keys, isLoading, createKey, deleteKey, isCreating, isDeleting } =
    useNineRouterKeys(serverId);

  if (!serverId) return null;

  return (
    <SettingsSection title="API Keys">
      <View style={settingsStyles.card}>
        {isLoading && (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        )}
        {!isLoading && keys.length === 0 && (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyText}>No API keys configured</Text>
          </View>
        )}
        {!isLoading &&
          keys.length > 0 &&
          keys.map((key) => (
            <KeyRow key={key.id} item={key} onDelete={deleteKey} isDeleting={isDeleting} />
          ))}
        <CreateKeyRow onCreate={createKey} isCreating={isCreating} />
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  keyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  keyInfo: {
    flex: 1,
    gap: theme.spacing[1],
  },
  keyName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  keyValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontFamily: isWeb ? "monospace" : undefined,
  },
  keyActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  iconBtn: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  dangerColor: {
    color: theme.colors.statusDanger,
  },
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  createInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
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
