import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@server": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    testTimeout: 30000,
    hookTimeout: 60000,
    globals: true,
    environment: "node",
    setupFiles: [path.resolve(__dirname, "./src/test-utils/vitest-setup.ts")],
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
        minForks: 1,
        maxForks: 1,
      },
    },
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**"],
    coverage: {
      provider: "v8",
      include: [
        "src/server/agent/providers/occ-agent.ts",
        "src/server/agent/providers/occ/event-mapper.ts",
        "src/server/agent/providers/crewai-agent.ts",
        "src/server/agent/providers/crewai/event-mapper.ts",
        "src/server/agent/providers/gemini-agent.ts",
        "src/server/agent/providers/gemini/event-mapper.ts",
        "src/server/nine-router-client.ts",
      ],
      thresholds: {
        lines: 98,
        perFile: true,
      },
    },
  },
});
