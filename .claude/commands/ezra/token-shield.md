---
tier: admin
name: ezra:token-shield
description: Token Shield status — validate Context Mode MCP, handoff files, and hook configuration. Run anytime to check token optimization health.
---

# Token Shield Status

Run the Token Shield validation to confirm all 3 layers are operational:

## What to check

1. **Layer 1 — Context Mode MCP**: Verify `context-mode` is configured in `~/.claude/.mcp.json` with a valid binary path and DB path.

2. **Layer 2 — Context Guardian (Stop hook)**: Verify `token-shield-validator.js` exists in `~/.claude/hooks/` and is wired in `settings.json` under `hooks.Stop`.

3. **Layer 3 — Session Auto-Loader (SessionStart hook)**: Verify `token-shield-validator.js` is wired in `settings.json` under `hooks.SessionStart`.

4. **Config integrity**: Verify `settings.json` is valid JSON with no BOM, `.mcp.json` is valid JSON.

5. **Handoff files**: Check if any recent handoff files exist in the project memory directory.

6. **Compact Instructions**: Verify the project CLAUDE.md has a `## Compact Instructions` section.

## If issues found

| Issue | Fix |
|-------|-----|
| Context Mode missing from .mcp.json | `npm install -g context-mode` then add entry to `~/.claude/.mcp.json` |
| settings.json BOM | Remove BOM with node one-liner |
| Hook not wired | Run `/ezra:install` to re-deploy hooks, then add entries to settings.json |
| No handoff files | Normal for first session — guardian creates them when transcript grows |

## Background

Token Shield saves 80-95% of token costs by:
- Sandboxing tool output (Context Mode: 98% reduction)
- Auto-generating handoff files when sessions grow large (Guardian)
- Announcing available handoffs in new sessions (Auto-Loader)
