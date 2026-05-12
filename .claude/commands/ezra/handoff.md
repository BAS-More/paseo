---
tier: admin
name: ezra:handoff
description: Generate session handoff briefing document
---

# /ezra:handoff — Session Handoff Export

## Purpose
Exports current project state as a structured briefing document for session handoff.
Lives in the repo as a timestamped markdown file.

## Usage
```
/ezra:handoff              — Generate and display handoff briefing
/ezra:handoff save         — Save briefing to .ezra/handoffs/
/ezra:handoff list         — List saved handoff briefs
```

## Behavior

### Generate Briefing
Compile a structured handoff brief from:
- `.ezra/versions/current.yaml` → health score, version
- `.ezra/knowledge.yaml` → architecture summary
- `.ezra/decisions/` → active decisions (last 10)
- `.ezra/versions/changelog.yaml` → recent changes (last 20)
- `.ezra/docs/registry.yaml` → document coverage gaps
- `.ezra/docs/.drift-counter.json` → drift counter
- `git log --oneline -10` → recent commits

### Save
When `save` is passed, writes the briefing to:
`.ezra/handoffs/{ISO-date}-handoff.md`

### List
Show all saved handoff briefs with dates and sizes.

## Output Format
```
EZRA HANDOFF BRIEF — {project} — {date}
═══════════════════════════════════════════════

HEALTH: {score}/100 | VERSION: {version}

ARCHITECTURE
{summary from knowledge.yaml}

RECENT DECISIONS (last 10)
- ADR-012: Switched to Fastify [ACTIVE]

RECENT CHANGES (last 20 entries)
- CHG-045: Decision ADR-012 created

OPEN ITEMS
- 3 critical documents missing
- Drift counter: 7 edits since last sync

RECENT COMMITS
- a1b2c3d fix: resolve auth middleware issue
```

## Data Source
- Uses `hooks/ezra-dashboard-data.js` for data collection
- Handoff storage: `.ezra/handoffs/`

## Cross-References
- /ezra:status — Quick project status
- /ezra:portfolio — Multi-project overview
- /ezra:dash — Visual dashboard
