import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";

interface ResolveDeps {
  platform: NodeJS.Platform;
  arch: string;
  isMusl: boolean;
  resolveFrom: (specifier: string) => string;
  fileExists: (path: string) => boolean;
}

// Upstream @anthropic-ai/claude-agent-sdk-linux-*-musl packages declare
// os/cpu but omit `libc`, so npm installs them on glibc Linux too. The SDK
// then prefers the musl variant in its own resolver and fails to launch on
// glibc. We sidestep that by resolving the bundled binary ourselves with
// correct libc detection and passing it via pathToClaudeCodeExecutable.
export function resolveBundledClaudeBinary(): string | null {
  return resolveBundledClaudeBinaryWith({
    platform: process.platform,
    arch: process.arch,
    isMusl: detectMusl(),
    resolveFrom: defaultResolve,
    fileExists: existsSync,
  });
}

export function resolveBundledClaudeBinaryWith(deps: ResolveDeps): string | null {
  const { platform, arch, isMusl, resolveFrom, fileExists } = deps;
  const ext = platform === "win32" ? ".exe" : "";

  const candidates: string[] = [];
  if (platform === "linux") {
    if (isMusl) {
      candidates.push(`${SDK_PACKAGE}-linux-${arch}-musl/claude${ext}`);
      candidates.push(`${SDK_PACKAGE}-linux-${arch}/claude${ext}`);
    } else {
      candidates.push(`${SDK_PACKAGE}-linux-${arch}/claude${ext}`);
    }
  } else {
    candidates.push(`${SDK_PACKAGE}-${platform}-${arch}/claude${ext}`);
  }

  for (const specifier of candidates) {
    let resolved: string;
    try {
      resolved = resolveFrom(specifier);
    } catch {
      continue;
    }
    if (fileExists(resolved)) {
      return resolved;
    }
  }
  return null;
}

function defaultResolve(specifier: string): string {
  const require = createRequire(import.meta.url);
  return require.resolve(specifier);
}

// Detect a musl-based libc by inspecting the Node runtime report. On glibc
// systems `glibcVersionRuntime` is a populated string; on musl it is absent.
// process.report is always defined in Node 22; the optional chains keep this
// safe across other runtimes.
function detectMusl(): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  type ReportWithHeader = { header?: { glibcVersionRuntime?: string } };
  const report = (
    process.report as unknown as { getReport?: () => ReportWithHeader } | undefined
  )?.getReport?.();
  const glibc = report?.header?.glibcVersionRuntime;
  return !glibc;
}
