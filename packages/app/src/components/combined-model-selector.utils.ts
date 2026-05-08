import type { AgentModelDefinition } from "@server/server/agent/agent-sdk-types";
import type { AgentProviderDefinition } from "@server/server/agent/provider-manifest";
import { buildFavoriteModelKey, type FavoriteModelRow } from "@/hooks/use-form-preferences";

export type SelectorModelRow = FavoriteModelRow;

export function resolveProviderLabel(
  providerDefinitions: AgentProviderDefinition[],
  providerId: string,
): string {
  return (
    providerDefinitions.find((definition) => definition.id === providerId)?.label ?? providerId
  );
}

export function buildSelectedTriggerLabel(modelLabel: string): string {
  return modelLabel;
}

export function buildModelRows(
  providerDefinitions: AgentProviderDefinition[],
  allProviderModels: Map<string, AgentModelDefinition[]>,
): SelectorModelRow[] {
  const providerLabelMap = new Map(
    providerDefinitions.map((definition) => [definition.id, definition.label]),
  );
  const rows: SelectorModelRow[] = [];

  for (const definition of providerDefinitions) {
    const providerLabel = providerLabelMap.get(definition.id) ?? definition.label;
    for (const model of allProviderModels.get(definition.id) ?? []) {
      rows.push({
        favoriteKey: buildFavoriteModelKey({ provider: definition.id, modelId: model.id }),
        provider: definition.id,
        providerLabel,
        modelId: model.id,
        modelLabel: model.label,
        description: model.description,
      });
    }
  }

  return rows;
}

export function matchesSearch(row: SelectorModelRow, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return true;
  }

  return [row.modelLabel, row.modelId, row.providerLabel].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

export type ModelCapabilityTier = "flagship" | "balanced" | "fast" | null;

const CAPABILITY_PATTERNS: Array<{ pattern: RegExp; tier: ModelCapabilityTier }> = [
  { pattern: /opus|o[13]-pro|gpt-4o(?!-mini)/i, tier: "flagship" },
  { pattern: /sonnet|gpt-4o-mini|gemini.*pro|codex/i, tier: "balanced" },
  { pattern: /haiku|gpt-3|flash|lite|mini/i, tier: "fast" },
];

export function getModelCapabilityTier(modelId: string): ModelCapabilityTier {
  for (const { pattern, tier } of CAPABILITY_PATTERNS) {
    if (pattern.test(modelId)) return tier;
  }
  return null;
}

export const CAPABILITY_LABELS: Record<Exclude<ModelCapabilityTier, null>, string> = {
  flagship: "Most capable",
  balanced: "Balanced",
  fast: "Fast",
};
