import React, { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { isWeb } from "@/constants/platform";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

interface ConfigField {
  key: string;
  label: string;
  placeholder: string;
}

const PROVIDER_CONFIG_FIELDS: Record<string, ConfigField[]> = {
  occ: [
    { key: "occPath", label: "Binary Path", placeholder: "occ (default)" },
    { key: "agentsPath", label: "Agents Path", placeholder: "OCC_AGENTS_PATH" },
    { key: "apiBaseUrl", label: "API Base URL", placeholder: "OPENAI_API_BASE" },
  ],
  crewai: [
    {
      key: "bridgeUrl",
      label: "Bridge URL",
      placeholder: "http://localhost:8000 (default)",
    },
  ],
  gemini: [{ key: "geminiPath", label: "Binary Path", placeholder: "gemini (default)" }],
};

interface ProviderConfigSectionProps {
  provider: string;
  serverId: string;
}

function ConfigFieldRow(props: {
  field: ConfigField;
  value: string;
  onChangeText: (key: string, value: string) => void;
}) {
  const { field, value, onChangeText } = props;
  const handleChange = useCallback(
    (text: string) => onChangeText(field.key, text),
    [field.key, onChangeText],
  );

  return (
    <View style={ROW_STYLE}>
      <Text style={settingsStyles.rowTitle}>{field.label}</Text>
      <AdaptiveTextInput
        value={value}
        onChangeText={handleChange}
        placeholder={field.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        // @ts-expect-error — outlineStyle is web-only
        style={INPUT_STYLE}
      />
    </View>
  );
}

export function ProviderConfigSection({ provider, serverId }: ProviderConfigSectionProps) {
  const fields = PROVIDER_CONFIG_FIELDS[provider];
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerConfig = config?.providers?.[provider] as Record<string, unknown> | undefined;

  const initialValues = useMemo(() => {
    const vals: Record<string, string> = {};
    if (fields) {
      for (const f of fields) {
        vals[f.key] = (providerConfig?.[f.key] as string) ?? "";
      }
    }
    return vals;
  }, [fields, providerConfig]);

  const [values, setValues] = useState<Record<string, string>>({});

  const mergedValues = useMemo(() => {
    const merged: Record<string, string> = {};
    if (fields) {
      for (const f of fields) {
        merged[f.key] = values[f.key] ?? initialValues[f.key] ?? "";
      }
    }
    return merged;
  }, [fields, initialValues, values]);

  const hasChanges = useMemo(() => {
    if (!fields) return false;
    return fields.some((f) => {
      const current = mergedValues[f.key] ?? "";
      const initial = initialValues[f.key] ?? "";
      return current !== initial;
    });
  }, [fields, mergedValues, initialValues]);

  const handleChange = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(() => {
    if (!hasChanges || saving) return;
    setError(null);
    setSaving(true);
    const patch: Record<string, string> = {};
    for (const [k, v] of Object.entries(mergedValues)) {
      if (v.length > 0) {
        patch[k] = v;
      }
    }
    void patchConfig({ providers: { [provider]: patch } })
      .then(() => setValues({}))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to save");
      })
      .finally(() => setSaving(false));
  }, [hasChanges, saving, mergedValues, patchConfig, provider]);

  if (!fields) return null;

  return (
    <SettingsSection title="Configuration">
      <View style={settingsStyles.card}>
        {fields.map((field) => (
          <ConfigFieldRow
            key={field.key}
            field={field}
            value={mergedValues[field.key] ?? ""}
            onChangeText={handleChange}
          />
        ))}
        {hasChanges ? (
          <View style={styles.saveRow}>
            <Button
              variant="default"
              size="sm"
              onPress={handleSave}
              disabled={saving}
              accessibilityLabel="Save configuration"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </View>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  fieldRow: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.spacing[1],
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  saveRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  errorText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.statusDanger,
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[3],
  },
}));

const ROW_STYLE = [settingsStyles.row, styles.fieldRow];
const INPUT_STYLE = [styles.input, isWeb && { outlineStyle: "none" }];
