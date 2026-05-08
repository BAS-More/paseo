import type { Logger } from "pino";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "./agent/agent-storage.js";

interface AutoImportOptions {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
}

export async function autoImportClaudeCodeSessions(options: AutoImportOptions): Promise<number> {
  const { agentManager, agentStorage, logger } = options;

  const storedRecords = await agentStorage.list();
  const knownSessionIds = new Set<string>();
  for (const record of storedRecords) {
    knownSessionIds.add(record.id);
    if (record.persistence?.sessionId) {
      knownSessionIds.add(record.persistence.sessionId);
    }
  }

  let descriptors;
  try {
    descriptors = await agentManager.listPersistedAgents({
      provider: "claude",
      limit: 500,
    });
  } catch (error) {
    logger.warn({ err: error }, "Claude session auto-import: discovery failed");
    return 0;
  }

  const newDescriptors = descriptors.filter((d) => !knownSessionIds.has(d.sessionId));

  if (newDescriptors.length === 0) {
    return 0;
  }

  let imported = 0;
  for (const descriptor of newDescriptors) {
    try {
      const timestamp = descriptor.lastActivityAt.toISOString();
      const record: StoredAgentRecord = {
        id: descriptor.sessionId,
        provider: descriptor.provider,
        cwd: descriptor.cwd,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastActivityAt: timestamp,
        title: descriptor.title,
        labels: {},
        lastStatus: "closed",
        persistence: {
          provider: descriptor.persistence.provider,
          sessionId: descriptor.persistence.sessionId,
          ...(descriptor.persistence.nativeHandle != null
            ? { nativeHandle: descriptor.persistence.nativeHandle }
            : {}),
          ...(descriptor.persistence.metadata != null
            ? { metadata: descriptor.persistence.metadata }
            : {}),
        },
      };
      await agentStorage.upsert(record);
      imported++;
    } catch (error) {
      logger.warn(
        { err: error, sessionId: descriptor.sessionId },
        "Claude session auto-import: failed to import session",
      );
    }
  }

  return imported;
}
