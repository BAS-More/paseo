import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, test } from "vitest";

import { probeExecutable } from "./executable.js";

const timeoutMs = 200;
const timeoutSlackMs = 500;
const tempDirs: string[] = [];

interface ProbeFixture {
  name: string;
  expected: boolean;
  create: (dir: string) => string;
}

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "paseo-probe-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(filePath: string, content: string | Buffer): string {
  writeFileSync(filePath, content);
  if (process.platform !== "win32") {
    chmodSync(filePath, 0o755);
  }
  return filePath;
}

function scriptPath(dir: string, name: string): string {
  return process.platform === "win32" ? path.join(dir, `${name}.cmd`) : path.join(dir, name);
}

function binaryPath(dir: string, name: string): string {
  return process.platform === "win32" ? path.join(dir, `${name}.exe`) : path.join(dir, name);
}

function createHangingFixture(dir: string): string {
  if (process.platform === "win32") {
    return writeExecutable(
      scriptPath(dir, "hangs"),
      "@echo off\r\n:loop\r\ntimeout /T 5 /NOBREAK > NUL\r\ngoto loop\r\n",
    );
  }
  return writeExecutable(
    scriptPath(dir, "hangs"),
    "#!/bin/sh\ntrap '' TERM\nwhile :; do sleep 60; done\n",
  );
}

function createNoVersionFixture(dir: string): string {
  if (process.platform === "win32") {
    return writeExecutable(scriptPath(dir, "no-version"), "@echo off\r\nexit /b 0\r\n");
  }
  return writeExecutable(scriptPath(dir, "no-version"), "#!/bin/sh\nexit 0\n");
}

function createNonZeroFixture(dir: string): string {
  if (process.platform === "win32") {
    return writeExecutable(
      scriptPath(dir, "non-zero"),
      "@echo off\r\necho oops 1>&2\r\nexit /b 1\r\n",
    );
  }
  return writeExecutable(scriptPath(dir, "non-zero"), "#!/bin/sh\necho oops 1>&2\nexit 1\n");
}

function createSlowSuccessFixture(dir: string): string {
  if (process.platform === "win32") {
    return writeExecutable(
      scriptPath(dir, "slow-success"),
      "@echo off\r\nping -n 1 127.0.0.1 > NUL\r\nexit /b 0\r\n",
    );
  }
  return writeExecutable(scriptPath(dir, "slow-success"), "#!/bin/sh\nsleep 0.05\nexit 0\n");
}

function createGarbageFixture(dir: string): string {
  return writeExecutable(binaryPath(dir, "garbage"), Buffer.from([0xff, 0x00, 0xfe, 0x01]));
}

function missingAbsolutePath(): string {
  return process.platform === "win32" ? "C:\\no\\such\\path.exe" : "/no/such/path";
}

const fixtures: ProbeFixture[] = [
  {
    name: "hangs forever after starting",
    expected: true,
    create: createHangingFixture,
  },
  {
    name: "does not know --version and exits zero",
    expected: true,
    create: createNoVersionFixture,
  },
  {
    name: "exits non-zero immediately",
    expected: true,
    create: createNonZeroFixture,
  },
  {
    name: "starts slowly and exits zero",
    expected: true,
    create: createSlowSuccessFixture,
  },
  {
    name: "has garbage content",
    expected: false,
    create: createGarbageFixture,
  },
  {
    name: "does not exist at an absolute path",
    expected: false,
    create: () => missingAbsolutePath(),
  },
];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("probeExecutable", () => {
  test.each(fixtures)("$name", async ({ create, expected }) => {
    const executablePath = create(makeTempDir());
    const startedAt = performance.now();

    const result = await probeExecutable(executablePath, timeoutMs);

    expect(result).toBe(expected);
    expect(performance.now() - startedAt).toBeLessThanOrEqual(timeoutMs + timeoutSlackMs);
  });
});
