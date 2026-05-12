import { describe, it, expect } from "vitest";
import { resolveBundledClaudeBinaryWith } from "./resolve-bundled-binary.js";

describe("resolveBundledClaudeBinary", () => {
  it("prefers glibc binary on glibc Linux even if musl directory exists", () => {
    const tried: string[] = [];
    const result = resolveBundledClaudeBinaryWith({
      platform: "linux",
      arch: "x64",
      isMusl: false,
      resolveFrom: (spec) => {
        tried.push(spec);
        return `/node_modules/${spec}`;
      },
      fileExists: () => true,
    });
    expect(result).toBe("/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude");
    expect(tried).toEqual(["@anthropic-ai/claude-agent-sdk-linux-x64/claude"]);
  });

  it("prefers musl binary on musl Linux and falls back to glibc when missing", () => {
    const result = resolveBundledClaudeBinaryWith({
      platform: "linux",
      arch: "x64",
      isMusl: true,
      resolveFrom: (spec) => `/node_modules/${spec}`,
      fileExists: (p) => p.includes("-musl/"),
    });
    expect(result).toBe("/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude");
  });

  it("falls back from musl to glibc when musl directory is absent", () => {
    const result = resolveBundledClaudeBinaryWith({
      platform: "linux",
      arch: "x64",
      isMusl: true,
      resolveFrom: (spec) => {
        if (spec.includes("-musl/")) throw new Error("MODULE_NOT_FOUND");
        return `/node_modules/${spec}`;
      },
      fileExists: () => true,
    });
    expect(result).toBe("/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude");
  });

  it("appends .exe on win32", () => {
    const result = resolveBundledClaudeBinaryWith({
      platform: "win32",
      arch: "x64",
      isMusl: false,
      resolveFrom: (spec) => `/node_modules/${spec}`,
      fileExists: () => true,
    });
    expect(result).toBe("/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe");
  });

  it("returns null when no variant is installed", () => {
    const result = resolveBundledClaudeBinaryWith({
      platform: "linux",
      arch: "x64",
      isMusl: false,
      resolveFrom: () => {
        throw new Error("MODULE_NOT_FOUND");
      },
      fileExists: () => false,
    });
    expect(result).toBeNull();
  });

  it("returns null when resolve succeeds but file is missing on disk", () => {
    const result = resolveBundledClaudeBinaryWith({
      platform: "darwin",
      arch: "arm64",
      isMusl: false,
      resolveFrom: (spec) => `/node_modules/${spec}`,
      fileExists: () => false,
    });
    expect(result).toBeNull();
  });
});
