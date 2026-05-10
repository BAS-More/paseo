import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

interface ConnectionTestResult {
  available: boolean;
  latencyMs?: number;
  error?: string;
}

type TestState = "idle" | "testing" | "done";

export interface ProviderConnectionTestProps {
  provider: string;
  serverId: string;
}

export function ProviderConnectionTest({ provider, serverId }: ProviderConnectionTestProps) {
  const client = useHostRuntimeClient(serverId);
  const [state, setState] = useState<TestState>("idle");
  const [result, setResult] = useState<ConnectionTestResult | null>(null);

  const handleTest = useCallback(async () => {
    if (!client) return;
    setState("testing");
    setResult(null);
    try {
      const response = await client.testProviderConnection(provider);
      setResult({
        available: response.available,
        latencyMs: response.latencyMs,
        error: response.error,
      });
    } catch (err) {
      setResult({
        available: false,
        error: err instanceof Error ? err.message : "Connection test failed",
      });
    } finally {
      setState("done");
    }
  }, [client, provider]);

  return (
    <View style={ROW_STYLE}>
      <View style={styles.content}>
        <Text style={settingsStyles.rowTitle}>Connection</Text>
        {state === "testing" && (
          <View style={styles.resultRow} testID="connection-test-loading">
            <ActivityIndicator size="small" />
            <Text style={styles.mutedText}>Testing...</Text>
          </View>
        )}
        {state === "done" && result?.available && (
          <View style={styles.resultRow}>
            <View style={styles.dotSuccess} />
            <Text style={styles.successText}>
              Available{result.latencyMs != null ? ` (${result.latencyMs}ms)` : ""}
            </Text>
          </View>
        )}
        {state === "done" && result && !result.available && (
          <View style={styles.resultRow}>
            <View style={styles.dotError} />
            <Text style={styles.errorText}>{result.error ?? "Not available"}</Text>
          </View>
        )}
      </View>
      <Button
        variant="outline"
        size="sm"
        onPress={handleTest}
        disabled={state === "testing"}
        accessibilityLabel="Test connection"
      >
        Test
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  content: {
    flex: 1,
    gap: theme.spacing[1],
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  dotSuccess: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.statusSuccess,
  },
  dotError: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.statusDanger,
  },
  successText: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.xs,
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));

const ROW_STYLE = [settingsStyles.row, styles.row];
