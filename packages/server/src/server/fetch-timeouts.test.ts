import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..", "..");

function read(p: string): string {
  return readFileSync(resolve(repoRoot, p), "utf8");
}

/**
 * M-06 / M-07: every outbound fetch in long-lived background services must have
 * a timeout. Without it, a stuck TCP connection wedges the daemon. These tests
 * lock the convention in source so a refactor that drops the signal regresses.
 */
describe("fetch timeouts (M-06, M-07)", () => {
  it("push-service fetch uses AbortSignal.timeout", () => {
    const src = read("packages/server/src/server/push/push-service.ts");
    // fetch(EXPO_PUSH_URL, { ...with signal: AbortSignal.timeout(...) })
    expect(src).toMatch(/fetch\(EXPO_PUSH_URL[\s\S]*?signal:\s*AbortSignal\.timeout\(/);
  });

  it("model-downloader fetch uses AbortSignal.timeout", () => {
    const src = read(
      "packages/server/src/server/speech/providers/local/sherpa/model-downloader.ts",
    );
    expect(src).toMatch(/fetch\(url,\s*\{\s*signal:\s*AbortSignal\.timeout\(/);
  });
});
