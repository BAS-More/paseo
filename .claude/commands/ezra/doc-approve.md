---
tier: admin
name: ezra:doc-approve
description: "Review and approve/reject pending document update proposals. Usage: /ezra:doc-approve (interactive review), /ezra:doc-approve PROP-001 (specific proposal), /ezra:doc-approve --all (approve all pending)."
---

You are processing EZRA document update proposals that are awaiting approval.

If `.ezra/` does not exist, tell the user to run `/ezra:init` first and stop.
If `.ezra/docs/proposals/` does not exist or is empty, report "No pending proposals."

## Argument Parsing

- `/ezra:doc-approve` → Interactive review of all PENDING proposals, one at a time
- `/ezra:doc-approve PROP-<NNN>` → Review a specific proposal by ID
- `/ezra:doc-approve --all` → Approve all pending proposals in one action (still list them first)
- `/ezra:doc-approve --reject-all` → Reject all pending proposals

## Load Proposals

Read all `.yaml` files in `.ezra/docs/proposals/`. Filter to `status: PENDING`.

Sort by:
1. `drift_level` severity (OBSOLETE > MAJOR > SIGNIFICANT > MINOR)
2. Document criticality (CRITICAL > HIGH > MEDIUM > LOW)
3. Creation date (oldest first)

## Interactive Review (default)

For each pending proposal, present:

```
═══════════════════════════════════════════════════════════════
PROP-<NNN> │ <doc-id> │ <document title>
Drift: <level> │ Since: <last update date> │ <n> files changed
═══════════════════════════════════════════════════════════════

WHY THIS UPDATE IS NEEDED:
  <2-3 sentence summary of what changed in the codebase>

PROPOSED CHANGES:
  ┌─────────────────────────────────────────────────────────┐
  │ Section                  │ Action  │ Summary            │
  ├─────────────────────────────────────────────────────────┤
  │ Infrastructure           │ UPDATE  │ Add Redis cache    │
  │ Authentication           │ REWRITE │ JWT → OAuth2       │
  │ Real-Time Communication  │ ADD     │ WebSocket gateway  │
  │ Dependencies             │ UPDATE  │ 3 new packages     │
  └─────────────────────────────────────────────────────────┘

IMPACT:
  Linked decisions: <ADR IDs or "none">
  Linked risks: <Risk IDs or "none">
  Other docs affected: <list or "none">

VERSION: <current> → <proposed>
═══════════════════════════════════════════════════════════════
```

Then ask:
"**Approve, Reject, Preview changes, Edit proposal, or Skip?**"

### On Approve

1. Read the existing document at `document_path`
2. For each `sections_affected` entry:
   - **UPDATE**: Find the section by heading, re-analyze the codebase for that section's scope, rewrite the section content with current information
   - **ADD**: Generate new section content based on codebase analysis, insert at the appropriate location in the document
   - **REMOVE**: Delete the section (mark with `<!-- REMOVED <date>: <reason> -->` comment if the user might want to reference it later)
   - **REWRITE**: Full section replacement based on current codebase state
3. Update frontmatter:
   - Bump `version`
   - Update `updated` timestamp
   - Update `linked_decisions` and `linked_risks` if changed
   - Set `status: CURRENT`
4. Add entry to Change History table:
   ```
   | <version> | <date> | EZRA (approved by user) | <summary of changes> |
   ```
5. Update `.ezra/docs/registry.yaml` with new version and timestamp
6. Mark proposal as `status: APPLIED` with `applied_date`
7. Confirm: "✅ <doc-id> updated: v<old> → v<new>"

### On Reject

1. Ask: "Reason for rejection? (optional, press Enter to skip)"
2. Mark proposal as `status: REJECTED` with `rejected_date` and `rejection_reason`
3. Confirm: "❌ <doc-id> proposal rejected."
4. Note: "This drift will be re-detected on next /ezra:doc-sync. To suppress, the document must be manually updated or the drift acknowledged."

### On Preview

1. Show the ACTUAL proposed content changes as a diff-style view:
   ```
   SECTION: Authentication
   ─── CURRENT ───
   <first 5 lines of current content>
   ...
   ─── PROPOSED ───
   <first 10 lines of what the new content would look like>
   ...
   ```
2. For ADD sections, show the full proposed content
3. After preview, re-ask: "Approve, Reject, Edit, or Skip?"

### On Edit

1. Ask: "What would you like changed about this proposal?"
2. User describes modifications
3. Update the proposal's `sections_affected` based on their input
4. Re-present the updated proposal
5. Re-ask for approval

### On Skip

1. Leave as `status: PENDING`
2. Move to next proposal
3. Note remaining count: "Skipped. <n> proposals remaining."

## Batch Approve (--all)

1. List all pending proposals in a compact table:
   ```
   PENDING PROPOSALS
   ═══════════════════════════════════════════════════════════
   PROP-001 │ tad       │ SIGNIFICANT │ 14 files │ 3 sections
   PROP-002 │ api-spec  │ MINOR       │ 3 files  │ 2 sections
   PROP-004 │ env-setup │ MINOR       │ 1 file   │ 1 section
   ═══════════════════════════════════════════════════════════
   3 proposals will be approved and applied.
   ```
2. Ask: "Confirm: approve and apply all 3 proposals?"
3. On confirmation, process each sequentially using the Approve flow
4. Present summary:
   ```
   BATCH APPROVE COMPLETE
   ═══════════════════════════════════════════════════════════
   ✅ tad       v1.1 → v1.2  (3 sections updated)
   ✅ api-spec  v2.0 → v2.1  (2 sections added)
   ✅ env-setup v1.0 → v1.1  (1 section updated)
   ═══════════════════════════════════════════════════════════
   ```

## Batch Reject (--reject-all)

1. List all pending proposals
2. Ask: "Confirm: reject all <n> proposals?"
3. On confirmation, mark all as REJECTED
4. Note: "Drift will be re-detected on next /ezra:doc-sync."

## Proposal Cleanup

Proposals older than 30 days with status APPLIED or REJECTED can be archived:
- Move to `.ezra/docs/proposals/archive/`
- This keeps the proposals directory clean

Check for archivable proposals at the end of every approve session and offer to clean up if >10 exist.

## Rules

- **Every change requires explicit approval.** Even in batch mode, confirm first.
- When generating updated content, ALWAYS re-analyze the actual codebase — never guess or use cached data.
- Preserve the user's own edits — if a section was manually edited, note the manual changes and propose additions alongside them, not replacements of them.
- Track who approved what and when — the Change History table is the audit trail.
- Cross-document impact: after applying updates, check if the changes affect other documents and note it.
