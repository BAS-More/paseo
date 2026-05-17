# Known Issues

## node-pty — beta prerelease (no stable 1.2.x)

**Package:** `node-pty@1.2.0-beta.12`
**Stable:** `1.1.0` (Dec 2025) — missing Node 22 support
**Impact:** Terminal/PTY tests skip on Windows due to EPERM when spawning PTYs in temp directories.

### Details

- `node-pty` 1.2.x betas added Node 22 + NAPI support but haven't shipped stable yet
- On Windows, `node-pty` beta builds cannot create PTYs in `%TEMP%` directories (EPERM)
- All PTY tests use `itUnlessPty` / `testUnlessPty` skip guards on Windows
- Tests pass on Linux CI (ubuntu-latest) — this is Windows-local only

### Mitigation

- Skip guards in `terminal-manager.test.ts` and `terminal.e2e.test.ts`
- Dependabot configured to auto-PR when `node-pty` 1.2.0 stable ships
- Fallback to `1.1.0` not viable — it lacks Node 22 native bindings

### Tracking

- Upstream: https://github.com/nicknisi/node-pty/releases
- Dependabot group: `node-pty` in `.github/dependabot.yml`
