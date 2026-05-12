---
tier: admin
name: ezra:version
description: "Version control for all EZRA state. Tracks every change to decisions, documents, governance, knowledge, and plans with immutable changelog. Usage: /ezra:version (show current), /ezra:version log (full history), /ezra:version snapshot (create named checkpoint), /ezra:version diff <v1> <v2> (compare two versions)."
---

You are managing the EZRA versioning system — the immutable audit trail of every governance change.

If `.ezra/` does not exist, tell the user to run `/ezra:init` first and stop.

## Core Principle

**Every change to `.ezra/` state is versioned.** Decisions, documents, governance rules, knowledge, plans, scan results — all tracked. Nothing drifts silently. Nothing is lost.

## State: `.ezra/versions/`

```
.ezra/versions/
├── changelog.yaml          # Append-only log of every state change
├── snapshots/              # Named checkpoints (manual or milestone-based)
│   ├── v1.0.0-init.yaml   # Initial state snapshot
│   ├── v1.1.0-mvp.yaml    # Named milestone snapshot
│   └── ...
└── current.yaml            # Current version metadata
```

### current.yaml Format

```yaml
version: <semver>
created: <ISO — when EZRA was initialized>
updated: <ISO — last state change>
total_changes: <count of changelog entries>

counts:
  decisions: <total across all statuses>
  documents: <total existing>
  scans: <total completed>
  plans: <total registered>
  risks: <total tracked>
  proposals: <pending count>

integrity:
  last_health_check: <ISO or "never">
  health_score: <0-100 or null>
  governance_compliant: <true/false/unknown>
```

### changelog.yaml Format (Append-Only)

```yaml
log:
  - id: CHG-001
    timestamp: <ISO>
    version_before: "1.0.0"
    version_after: "1.0.1"
    type: DECISION | DOCUMENT | GOVERNANCE | KNOWLEDGE | PLAN | SCAN | RISK | PROPOSAL | SNAPSHOT
    action: CREATED | UPDATED | SUPERSEDED | DELETED | APPROVED | REJECTED | APPLIED
    target: <specific item ID or path>
    summary: <one-line description of what changed>
    triggered_by: <user | doc-sync | scan | guard | auto>
    
  - id: CHG-002
    timestamp: <ISO>
    ...
```

**This file is APPEND-ONLY. Entries are never modified or deleted.** This is the audit trail.

## Argument Parsing

- `/ezra:version` → Show current version state
- `/ezra:version log` → Show full changelog (most recent first, paginated)
- `/ezra:version log <n>` → Show last N entries
- `/ezra:version log --type <type>` → Filter by change type
- `/ezra:version snapshot <name>` → Create a named checkpoint
- `/ezra:version diff <v1> <v2>` → Compare two snapshots
- `/ezra:version bump <major|minor|patch>` → Manual version bump with description

## ACTION: (no args) — Show Current State

```
EZRA VERSION STATUS
═══════════════════════════════════════════════════
Version: <semver>
Initialized: <date>
Last Change: <date> (<relative — e.g., "2 hours ago">)
Total Changes: <n>

State Counts:
  Decisions:    <n> (<active>A / <superseded>S)
  Documents:    <n> / 81 (<pct>% coverage)
  Scans:        <n> completed
  Plans:        <n> active
  Risks:        <n> open
  Proposals:    <n> pending approval

Recent Changes (last 5):
  CHG-<n> │ <date> │ <type> │ <action> │ <summary>
  CHG-<n> │ <date> │ <type> │ <action> │ <summary>
  CHG-<n> │ <date> │ <type> │ <action> │ <summary>
  CHG-<n> │ <date> │ <type> │ <action> │ <summary>
  CHG-<n> │ <date> │ <type> │ <action> │ <summary>

Snapshots: <n> saved
  <name> │ v<version> │ <date>
  <name> │ v<version> │ <date>
═══════════════════════════════════════════════════
```

## ACTION: log — Full Changelog

Present changelog entries in reverse chronological order:

```
EZRA CHANGELOG
═══════════════════════════════════════════════════
Showing: <range> of <total> changes

CHG-042 │ 2026-03-19T14:32:00 │ v1.3.1
  DOCUMENT APPLIED │ tad updated v1.1→v1.2
  Triggered by: doc-sync (approved by user)

CHG-041 │ 2026-03-19T14:30:00 │ v1.3.0  
  PROPOSAL APPROVED │ PROP-001 tad SIGNIFICANT drift
  Triggered by: user via /ezra:doc-approve

CHG-040 │ 2026-03-19T12:15:00 │ v1.2.9
  DECISION CREATED │ ADR-015 Use Redis for session caching
  Triggered by: user via /ezra:decide

CHG-039 │ 2026-03-19T10:00:00 │ v1.2.8
  SCAN COMPLETED │ Health: 72/100 │ 1C 3H 5M findings
  Triggered by: user via /ezra:scan
...

Page 1 of <n>. Show more? [Y/n]
═══════════════════════════════════════════════════
```

## ACTION: snapshot <name> — Create Checkpoint

1. Read ALL current `.ezra/` state
2. Create `.ezra/versions/snapshots/<version>-<name>.yaml`:

```yaml
snapshot:
  name: <user-provided name>
  version: <current version>
  timestamp: <ISO>
  description: <ask user or auto-generate from recent changes>
  
  state:
    decisions:
      total: <n>
      active: <list of IDs and one-line summaries>
      superseded: <list of IDs>
    
    documents:
      total: <n>
      by_phase:
        pre_dev: <list of IDs with versions>
        dev: <list of IDs with versions>
        post_dev: <list of IDs with versions>
      coverage: <pct>
    
    governance:
      protected_paths: <count>
      standards: <list>
      enforcement: <config summary>
    
    knowledge:
      confidence: <level>
      architecture: <1-line summary>
      last_scan: <date>
      health_score: <score>
    
    plans:
      active: <list with completion %>
    
    risks:
      open: <list of IDs and summaries>
      managed: <count>
      closed: <count>
    
    metrics:
      total_changelog_entries: <n>
      total_scans: <n>
      total_proposals: <created / approved / rejected>
```

3. Append to changelog
4. Bump patch version
5. Report: "✅ Snapshot '<name>' saved at v<version>"

## ACTION: diff <v1> <v2> — Compare Snapshots

Load two snapshots and compare:

```
EZRA VERSION DIFF
═══════════════════════════════════════════════════
Comparing: <v1-name> (v<v1>) → <v2-name> (v<v2>)
Period: <date1> → <date2>
Changes: <n> changelog entries between versions

DECISIONS:
  + ADR-015 Use Redis for session caching (NEW)
  + ADR-016 OAuth2 for authentication (NEW)
  ~ ADR-003 JWT signing → SUPERSEDED by ADR-016
  
DOCUMENTS:
  + tad v1.0 → v1.2 (2 updates)
  + api-spec CREATED v1.0
  + deploy-runbook CREATED v1.0
  Coverage: 25% → 33%

GOVERNANCE:
  + 2 new protected paths added
  ~ test_coverage_minimum: 80 → 90

KNOWLEDGE:
  Confidence: INITIAL → MEDIUM
  Health: —/100 → 72/100

PLANS:
  ~ mvp-plan: 15% → 67%

RISKS:
  + 2 new risks opened
  - 1 risk closed
  Open: 3 → 4
═══════════════════════════════════════════════════
```

## ACTION: bump <major|minor|patch> — Manual Version Bump

1. Ask: "Description for this version bump?"
2. Increment version per semver:
   - **major**: Breaking governance changes, new project phase, major restructure
   - **minor**: New decisions, new documents, significant scan results
   - **patch**: Document updates, minor governance tweaks, proposals applied
3. Update `current.yaml`
4. Append to changelog
5. Optionally auto-create snapshot for major/minor bumps

## Auto-Versioning Rules

Other EZRA commands MUST call the versioning system when they modify state:

| Command | Version Bump | Changelog Entry |
|---------|-------------|-----------------|
| `/ezra:decide` | patch | DECISION CREATED |
| `/ezra:doc create` | patch | DOCUMENT CREATED |
| `/ezra:doc-approve` (apply) | patch | DOCUMENT APPLIED |
| `/ezra:doc-approve` (reject) | — | PROPOSAL REJECTED (logged, no bump) |
| `/ezra:scan` | patch | SCAN COMPLETED |
| `/ezra:guard` (violations found) | — | GUARD VIOLATION (logged, no bump) |
| `/ezra:reconcile` | patch | RECONCILIATION COMPLETED |
| `/ezra:init` | major (1.0.0) | EZRA INITIALIZED |
| Phase change | minor | PHASE CHANGED |

**Every command that writes to `.ezra/` must also write to `changelog.yaml` and update `current.yaml`.** This is enforced by convention in the command definitions — each command's instructions include the versioning step.

## Rules

- **changelog.yaml is APPEND-ONLY.** Never modify or delete entries.
- **Every state change gets a changelog entry.** No silent modifications.
- **Snapshots are immutable.** Once created, never modified.
- **Version numbers only go up.** No rollbacks to lower versions.
- Auto-version bumps are always patch. User can manually bump minor/major for milestones.
