---
tier: admin
name: ezra:doc-sync
description: "Detect drift between codebase and existing documents. Proposes updates for your approval before applying. Usage: /ezra:doc-sync (all docs), /ezra:doc-sync <type> (specific doc), /ezra:doc-sync --auto (queue all proposals)."
---

You are running EZRA document synchronization — the system that keeps docs alive as the project evolves.

If `.ezra/` does not exist, tell the user to run `/ezra:init` first and stop.

## Core Principle

**Documents are living artifacts.** Code changes → docs may need updating. But NO document update is applied without explicit user approval. Every change goes through a proposal → review → approve/reject cycle.

## Argument Parsing

- `/ezra:doc-sync` → Scan ALL existing documents for drift
- `/ezra:doc-sync <type>` → Scan a specific document (e.g., `/ezra:doc-sync tad`)
- `/ezra:doc-sync --auto` → Queue all proposals and present them for batch approval
- `/ezra:doc-sync --status` → Show pending proposals

## Phase 1: Drift Detection

For each existing document in `.ezra/docs/registry.yaml`:

### 1A. Identify What Changed Since Last Doc Update

```bash
# Get files changed since the document was last updated
git log --since="<doc.updated>" --name-only --pretty=format: | sort -u
```

### 1B. Determine Relevance

For each document, assess whether code changes affect it:

| Document Type | Triggered By Changes To |
|---------------|------------------------|
| `tad` | New directories, new services, changed entry points, new dependencies, infrastructure files |
| `api-spec` | Route files, controller files, middleware, request/response types |
| `data-model` | Migration files, schema files, ORM models, entity definitions |
| `security-arch` | Auth files, middleware, encryption, environment configs, CORS |
| `coding-standards` | Linter configs, tsconfig, prettier config, eslint rules |
| `test-strategy` | Test config files, new test directories, coverage config |
| `dependencies` | package.json, lock files, new imports |
| `deploy-runbook` | Dockerfiles, CI/CD configs, deployment scripts, infrastructure |
| `env-setup` | .env files, docker-compose, setup scripts |
| `api-docs` | Any file matching route/controller/handler patterns |
| `migrations` | Any file in migrations/ or schema/ directories |
| `release-notes` | Any tagged release since last update |
| `user-guide` | UI components, user-facing features, configuration options |
| `monitoring` | Logging configs, health checks, metrics endpoints |
| `adr` | New decisions in `.ezra/decisions/` since last sync |
| `risk-register` | New risks or risk status changes |

For document types not listed above, use general heuristic:
- If >20% of files the doc references have changed → LIKELY STALE
- If new files exist in directories the doc covers → POSSIBLY STALE
- If dependencies the doc mentions have version changes → CHECK

### 1C. Classify Drift

For each document, assign a drift level:

- **NO_DRIFT** — No relevant changes detected. Doc is current.
- **MINOR_DRIFT** — Small changes that may need a sentence or two updated.
- **SIGNIFICANT_DRIFT** — Structural changes that require section rewrites.
- **MAJOR_DRIFT** — Architecture or pattern changes that require substantial rewrite.
- **OBSOLETE** — The thing the document describes no longer exists.

## Phase 2: Generate Proposals

For each document with drift (MINOR or above), create a proposal file:

`.ezra/docs/proposals/<doc-id>-<timestamp>.yaml`:

```yaml
id: PROP-<NNN>
document_id: <doc type id>
document_title: <title>
document_path: <path to existing doc>
drift_level: MINOR | SIGNIFICANT | MAJOR | OBSOLETE
created: <ISO timestamp>
status: PENDING  # PENDING | APPROVED | REJECTED | APPLIED

trigger:
  files_changed: <count of relevant files changed>
  key_changes:
    - <1-line description of relevant change>
    - <1-line description>
    - <1-line description>
  since: <last doc update date>

proposed_changes:
  summary: <2-3 sentence description of what needs updating>
  
  sections_affected:
    - section: <section heading in the document>
      change_type: UPDATE | ADD | REMOVE | REWRITE
      current_content_summary: <what it says now — 1 line>
      proposed_content_summary: <what it should say — 1 line>
      reason: <why this change is needed>
    
    - section: <another section>
      change_type: ADD
      proposed_content_summary: <new content description>
      reason: <why>

  new_version: <bumped version number>
  
impact:
  linked_decisions: <any new decisions that relate>
  linked_risks: <any risks affected>
  other_docs_affected: <list of other docs that may also need updating>
```

## Phase 3: Present Proposals for Approval

Present each proposal clearly and ask for explicit approval:

```
EZRA DOCUMENT SYNC — Proposals
═══════════════════════════════════════════════════════════════

PROP-001 │ tad │ Technical Architecture Document
Drift: SIGNIFICANT │ 14 files changed since last update (2026-02-15)
Key changes:
  • New Redis caching layer added (src/cache/)
  • Auth middleware refactored from JWT to OAuth2
  • New WebSocket gateway (src/gateway/)
Proposed updates:
  • UPDATE "Infrastructure" section — add Redis
  • REWRITE "Authentication" section — JWT → OAuth2
  • ADD "Real-Time Communication" section — WebSocket gateway
  • UPDATE dependency list
Impact: Also affects api-spec, security-arch

Action? [A]pprove / [R]eject / [E]dit / [S]kip / [D]etail
───────────────────────────────────────────────────────────────

PROP-002 │ api-spec │ API Design Specification
Drift: MINOR │ 3 files changed since last update (2026-03-10)
Key changes:
  • New /ws endpoint for WebSocket connections
  • Rate limit headers added to all responses
Proposed updates:
  • ADD WebSocket endpoint documentation
  • UPDATE response headers section
Impact: None

Action? [A]pprove / [R]eject / [E]dit / [S]kip / [D]etail
───────────────────────────────────────────────────────────────

Summary: 2 proposals │ 1 SIGNIFICANT │ 1 MINOR
```

## Phase 4: Process Approvals

Based on user response:

### [A]pprove
1. Mark proposal as `APPROVED` in the proposal file
2. Execute the update:
   - Read the existing document
   - Apply the proposed changes (update/add/remove/rewrite sections)
   - Bump version number
   - Update the `updated` timestamp
   - Add entry to Change History table in the document
   - Update `.ezra/docs/registry.yaml`
3. Mark proposal as `APPLIED`
4. Log: "✅ <doc-id> updated to v<version>"

### [R]eject
1. Mark proposal as `REJECTED` with reason if given
2. Log: "❌ <doc-id> — proposal rejected"
3. The document stays as-is. EZRA will re-detect this drift on next sync.

### [E]dit
1. Ask the user what they want changed about the proposal
2. Regenerate the proposal with their modifications
3. Re-present for approval

### [S]kip
1. Leave proposal as `PENDING`
2. Move to next proposal
3. Skipped proposals remain in `.ezra/docs/proposals/` for later review

### [D]etail
1. Show the full proposed content changes (actual markdown diff)
2. Then re-ask for action

## Phase 5: Cross-Document Impact

After applying approved updates, check `impact.other_docs_affected`:
- If other docs are affected, create new proposals for those docs
- Present them in the next sync cycle (don't cascade automatically)
- Log: "⚠️ <n> additional docs may need updating — run /ezra:doc-sync to review"

## Phase 6: Summary

```
EZRA DOC-SYNC COMPLETE
═══════════════════════════════════════════════════════════════
Scanned: <n> documents
No drift: <n>
Proposals generated: <n>
  Approved & applied: <n>
  Rejected: <n>
  Skipped (pending): <n>

Updated documents:
  ✅ tad    v1.1 → v1.2  (3 sections updated)
  ✅ api-spec v2.0 → v2.1  (2 sections added)

Pending proposals: <n> — run /ezra:doc-sync --status to review
Cascading impact: <n> additional docs may need updating
═══════════════════════════════════════════════════════════════
```

## Batch Mode (--auto)

When `--auto` flag is used:
1. Run all drift detection and proposal generation
2. Present ALL proposals in a summary table
3. Ask for batch action: "Approve all / Review individually / Reject all"
4. If "Approve all" — apply all proposals sequentially
5. If "Review individually" — fall through to standard Phase 3 flow

## Status Mode (--status)

When `--status` flag is used:
1. Read all files in `.ezra/docs/proposals/`
2. Show pending proposals:

```
EZRA DOC-SYNC — Pending Proposals
═══════════════════════════════════════════════════════════════
PROP-001 │ tad      │ SIGNIFICANT │ Created 2026-03-19 │ PENDING
PROP-003 │ env-setup │ MINOR      │ Created 2026-03-18 │ PENDING

2 pending proposals. Run /ezra:doc-sync to review and approve.
═══════════════════════════════════════════════════════════════
```

## Rules

- **NEVER apply document changes without explicit approval.** This is non-negotiable.
- Generate real, specific proposals based on actual code changes — not vague "this might need updating."
- Keep proposals concise. The user needs to make quick decisions, not read essays.
- Track all proposals persistently so nothing falls through cracks.
- Cross-reference decisions and risks — if a new ADR was recorded, affected docs should be flagged.
