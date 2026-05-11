import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { acquirePidLock, getPidLockInfo, releasePidLock, updatePidLock } from "./pid-lock.js";

describe("pid-lock ownership", () => {
  test("writes and releases lock for explicit owner pid", async () => {
    const paseoHome = await mkdtemp(join(tmpdir(), "paseo-pid-lock-owner-"));
    const ownerPid = process.pid + 10_000;

    try {
      await (
        acquirePidLock as unknown as (
          home: string,
          sockPath: string | null,
          options: { ownerPid: number },
        ) => Promise<void>
      )(paseoHome, null, { ownerPid });

      const lock = await getPidLockInfo(paseoHome);
      expect(lock?.pid).toBe(ownerPid);
      expect(lock?.listen).toBeNull();

      await (
        updatePidLock as unknown as (
          home: string,
          patch: { listen: string },
          options: { ownerPid: number },
        ) => Promise<void>
      )(paseoHome, { listen: "127.0.0.1:6767" }, { ownerPid });

      const updatedLock = await getPidLockInfo(paseoHome);
      expect(updatedLock?.listen).toBe("127.0.0.1:6767");

      await (
        releasePidLock as unknown as (home: string, options: { ownerPid: number }) => Promise<void>
      )(paseoHome, { ownerPid: ownerPid + 1 });
      const lockAfterWrongOwnerRelease = await getPidLockInfo(paseoHome);
      expect(lockAfterWrongOwnerRelease?.pid).toBe(ownerPid);

      await (
        releasePidLock as unknown as (home: string, options: { ownerPid: number }) => Promise<void>
      )(paseoHome, { ownerPid });
      const lockAfterOwnerRelease = await getPidLockInfo(paseoHome);
      expect(lockAfterOwnerRelease).toBeNull();
    } finally {
      await rm(paseoHome, { recursive: true, force: true });
    }
  });
});

describe("pid-lock auto-release on process.exit (M-05)", () => {
  test("acquirePidLock registers an `exit` listener that removes our lockfile", async () => {
    const paseoHome = await mkdtemp(join(tmpdir(), "paseo-pid-lock-auto-"));
    const ownerPid = process.pid + 20_000;

    try {
      const before = process.listenerCount("exit");
      await (
        acquirePidLock as unknown as (
          home: string,
          sockPath: string | null,
          options: { ownerPid: number },
        ) => Promise<void>
      )(paseoHome, null, { ownerPid });

      // A new `exit` listener is wired.
      expect(process.listenerCount("exit")).toBeGreaterThan(before);
      // Lockfile is present (from acquire).
      expect(existsSync(join(paseoHome, "paseo.pid"))).toBe(true);

      // Manually invoke the exit handlers and confirm the lockfile is cleaned.
      // (process.emit("exit") triggers all listeners synchronously.)
      process.emit("exit", 0);
      expect(existsSync(join(paseoHome, "paseo.pid"))).toBe(false);
    } finally {
      await rm(paseoHome, { recursive: true, force: true });
    }
  });

  test("autoRelease: false suppresses the exit listener", async () => {
    const paseoHome = await mkdtemp(join(tmpdir(), "paseo-pid-lock-noauto-"));
    const ownerPid = process.pid + 30_000;

    try {
      const before = process.listenerCount("exit");
      await (
        acquirePidLock as unknown as (
          home: string,
          sockPath: string | null,
          options: { ownerPid: number; autoRelease: boolean },
        ) => Promise<void>
      )(paseoHome, null, { ownerPid, autoRelease: false });

      expect(process.listenerCount("exit")).toBe(before);
    } finally {
      await rm(paseoHome, { recursive: true, force: true });
    }
  });
});
