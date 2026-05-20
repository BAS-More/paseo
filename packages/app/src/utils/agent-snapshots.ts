import type { AgentSnapshotPayload } from "@server/shared/messages";
import type { AgentPermissionRequest } from "@server/server/agent/agent-sdk-types";
import { PARENT_AGENT_ID_LABEL } from "@server/shared/agent-labels";
import type { Agent } from "@/stores/session-store";

export function derivePendingPermissionKey(
  agentId: string,
  request: AgentPermissionRequest,
): string {
  const fallbackId =
    request.id ||
    (typeof request.metadata?.id === "string" ? request.metadata.id : undefined) ||
    request.name ||
    request.title ||
    `${request.kind}:${JSON.stringify(request.input ?? request.metadata ?? {})}`;

  return `${agentId}:${fallbackId}`;
}

export function normalizeAgentSnapshot(
  snapshot: AgentSnapshotPayload,
  serverId: string,
): Omit<Agent, "projectPlacement"> {
  const createdAt = new Date(snapshot.createdAt);
  const updatedAt = new Date(snapshot.updatedAt);
  const lastUserMessageAt = snapshot.lastUserMessageAt
    ? new Date(snapshot.lastUserMessageAt)
    : null;
  const attentionTimestamp = snapshot.attentionTimestamp
    ? new Date(snapshot.attentionTimestamp)
    : null;
  const archivedAt = snapshot.archivedAt ? new Date(snapshot.archivedAt) : null;
  const parentAgentLabel = snapshot.labels?.[PARENT_AGENT_ID_LABEL];
  const parentAgentId =
    typeof parentAgentLabel === "string" && parentAgentLabel.trim().length > 0
      ? parentAgentLabel.trim()
      : null;

  return {
    serverId,
    id: snapshot.id,
    provider: snapshot.provider,
    status: snapshot.status,
    createdAt,
    updatedAt,
    lastUserMessageAt,
    lastActivityAt: updatedAt,
    capabilities: snapshot.capabilities,
    currentModeId: snapshot.currentModeId,
    availableModes: snapshot.availableModes ?? [],
    pendingPermissions: (snapshot.pendingPermissions ?? []) as AgentPermissionRequest[],
    persistence: snapshot.persistence ?? null,
    runtimeInfo: snapshot.runtimeInfo,
    lastUsage: snapshot.lastUsage,
    lastError: snapshot.lastError ?? null,
    title: snapshot.title ?? null,
    cwd: snapshot.cwd,
    model: snapshot.model ?? null,
    features: snapshot.features,
    thinkingOptionId: snapshot.thinkingOptionId ?? null,
    requiresAttention: snapshot.requiresAttention ?? false,
    attentionReason: snapshot.attentionReason ?? null,
    attentionTimestamp,
    archivedAt,
    parentAgentId,
    labels: snapshot.labels,
  };
}
