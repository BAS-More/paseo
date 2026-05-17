import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import { useModelAliases } from "@/hooks/use-model-aliases";
import { AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/screens/settings/settings-section";
import { isWeb } from "@/constants/platform";

export interface NineRouterModelAliasesPanelProps {
  serverId: string | null;
}

function AliasRow({
  alias,
  target,
  onDelete,
  onTest,
  isDeleting,
  isTesting,
}: {
  alias: string;
  target: string;
  onDelete: () => void;
  onTest: () => void;
  isDeleting: boolean;
  isTesting: boolean;
}) {
  return (
    <View style={styles.aliasRow}>
      <View style={styles.aliasInfo}>
        <Text style={styles.aliasName}>{alias}</Text>
        <Text style={styles.aliasTarget}>→ {target}</Text>
      </View>
      <View style={styles.aliasActions}>
        <Pressable
          onPress={onTest}
          disabled={isTesting}
          accessibilityLabel={`Test ${alias}`}
          style={styles.actionBtn}
        >
          <Text style={styles.actionText}>{isTesting ? "…" : "Test"}</Text>
        </Pressable>
        <Pressable
          onPress={onDelete}
          disabled={isDeleting}
          accessibilityLabel={`Delete ${alias}`}
          style={styles.actionBtn}
        >
          <Text style={styles.deleteText}>{isDeleting ? "…" : "×"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CreateAliasForm({
  onSubmit,
  isSubmitting,
}: {
  onSubmit: (alias: string, target: string) => void;
  isSubmitting: boolean;
}) {
  const [alias, setAlias] = useState("");
  const [target, setTarget] = useState("");

  const handleSubmit = useCallback(() => {
    const trimmedAlias = alias.trim();
    const trimmedTarget = target.trim();
    if (!trimmedAlias || !trimmedTarget) return;
    onSubmit(trimmedAlias, trimmedTarget);
    setAlias("");
    setTarget("");
  }, [alias, target, onSubmit]);

  const canSubmit = alias.trim().length > 0 && target.trim().length > 0 && !isSubmitting;

  const inputStyle = useMemo(
    () => [styles.formInput, isWeb && { outlineStyle: "none" as const }],
    [],
  );

  return (
    <View style={styles.formRow}>
      <View style={styles.formInputs}>
        <AdaptiveTextInput
          value={alias}
          onChangeText={setAlias}
          placeholder="Alias (e.g. best)"
          autoCapitalize="none"
          autoCorrect={false}
          // @ts-expect-error — outlineStyle is web-only
          style={inputStyle}
        />
        <AdaptiveTextInput
          value={target}
          onChangeText={setTarget}
          placeholder="Target model"
          autoCapitalize="none"
          autoCorrect={false}
          // @ts-expect-error — outlineStyle is web-only
          style={inputStyle}
        />
      </View>
      <Button
        variant="default"
        size="sm"
        onPress={handleSubmit}
        disabled={!canSubmit}
        accessibilityLabel="Add model alias"
      >
        {isSubmitting ? "Adding…" : "Add"}
      </Button>
    </View>
  );
}

function ConnectedAliasRow({
  alias,
  target,
  deleteAlias,
  testModel,
  isDeletingAlias,
  isTesting,
}: {
  alias: string;
  target: string;
  deleteAlias: (alias: string) => void;
  testModel: (model: string) => void;
  isDeletingAlias: boolean;
  isTesting: boolean;
}) {
  const handleDelete = useCallback(() => deleteAlias(alias), [deleteAlias, alias]);
  const handleTest = useCallback(() => testModel(target), [testModel, target]);

  return (
    <AliasRow
      alias={alias}
      target={target}
      onDelete={handleDelete}
      onTest={handleTest}
      isDeleting={isDeletingAlias}
      isTesting={isTesting}
    />
  );
}

function ModelAliasesPanelContent({ serverId }: { serverId: string }) {
  const {
    aliases,
    isLoading,
    setAlias,
    deleteAlias,
    testModel,
    isSettingAlias,
    isDeletingAlias,
    isTesting,
    testResult,
  } = useModelAliases(serverId);

  const entries = useMemo(() => (aliases ? Object.entries(aliases) : []), [aliases]);

  return (
    <SettingsSection title="Model Aliases">
      <View style={settingsStyles.card}>
        {isLoading && (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        )}
        {!isLoading && entries.length === 0 && (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyText}>No aliases configured</Text>
          </View>
        )}
        {!isLoading &&
          entries.map(([alias, target]) => (
            <ConnectedAliasRow
              key={alias}
              alias={alias}
              target={target}
              deleteAlias={deleteAlias}
              testModel={testModel}
              isDeletingAlias={isDeletingAlias}
              isTesting={isTesting}
            />
          ))}
        {testResult && (
          <View style={styles.testResultRow}>
            <Text style={testResult.success ? styles.testSuccess : styles.testFail}>
              {testResult.success
                ? `✓ ${testResult.provider} — ${testResult.latencyMs}ms`
                : "✗ Model unreachable"}
            </Text>
          </View>
        )}
        <CreateAliasForm onSubmit={setAlias} isSubmitting={isSettingAlias} />
      </View>
    </SettingsSection>
  );
}

export function NineRouterModelAliasesPanel({ serverId }: NineRouterModelAliasesPanelProps) {
  if (!serverId) return null;
  return <ModelAliasesPanelContent serverId={serverId} />;
}

const styles = StyleSheet.create((theme) => ({
  centered: {
    paddingVertical: theme.spacing[4],
    alignItems: "center",
  },
  emptyRow: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  aliasRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  aliasInfo: {
    flex: 1,
    gap: 2,
  },
  aliasName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  aliasTarget: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  aliasActions: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  actionBtn: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  actionText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  deleteText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.bold,
  },
  formRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  formInputs: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  formInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  testResultRow: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  testSuccess: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.xs,
  },
  testFail: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
  },
}));
