---
tier: advanced
name: ezra:reconcile
description: Compare what was planned against what was actually implemented. Identifies gaps, drift, and unplanned additions. Requires a plan registered in .ezra/plans/.
---

You are running EZRA plan reconciliation.

First, read `.ezra/plans/` to find registered plans.

If `.ezra/` does not exist, tell the user to run `/ezra:init` first and stop.

## If No Plans Exist

If `.ezra/plans/` is empty or does not exist:

```
EZRA RECONCILE
═══════════════════════════════════════════
No plans registered for reconciliation.

To register a plan:
  1. Create a plan file (YAML/MD) describing intended work
  2. Save it to .ezra/plans/<plan-name>.yaml
  3. Or describe your plan and I will create one

Would you like to register a plan now?
═══════════════════════════════════════════
```

If the user provides a plan description (via $ARGUMENTS or conversation), create a plan file:

```yaml
# .ezra/plans/<plan-name>.yaml
name: <plan name>
created: <ISO timestamp>
status: active
description: <one paragraph summary>

planned_items:
  - id: P001
    description: <what should be done>
    files_expected: <list of files expected to change>
    acceptance: <how to verify completion>
    status: pending
  - id: P002
    description: <next item>
    files_expected: []
    acceptance: <criteria>
    status: pending

constraints:
  - <any constraints or things that should NOT change>
```

## If Plans Exist

For each active plan in `.ezra/plans/`:

### Phase 1: Planned vs Implemented

For each `planned_item`:
1. Check if the expected files were modified (git log, file timestamps, or content analysis)
2. Check if the acceptance criteria can be verified
3. Mark as: `COMPLETE`, `PARTIAL`, `MISSING`, or `SKIPPED`

### Phase 2: Unplanned Changes

1. List all files changed since the plan was created (use git log with date filter)
2. Compare against all `files_expected` across all plan items
3. Any changed file NOT in any plan item's expected files = **UNPLANNED CHANGE**
4. Classify unplanned changes: refactor, bugfix, infrastructure, dependency update, unknown

### Phase 3: Constraint Verification

For each constraint in the plan:
1. Verify the constraint was respected
2. If violated, flag with specifics

### Phase 4: Generate Reconciliation Report

Save to `.ezra/scans/<ISO-date>-reconcile.yaml`:

```yaml
timestamp: <ISO>
plan: <plan name>
plan_created: <date>

planned_items:
  - id: P001
    status: COMPLETE | PARTIAL | MISSING | SKIPPED
    evidence: <what was found>
    notes: <any deviations>

completion:
  total: <count>
  complete: <count>
  partial: <count>
  missing: <count>
  skipped: <count>
  percentage: <calculated>

unplanned_changes:
  count: <n>
  files:
    - file: <path>
      classification: <refactor|bugfix|infrastructure|dependency|unknown>
      risk: <LOW|MEDIUM|HIGH>

constraint_violations:
  - constraint: <text>
    violated: <true/false>
    details: <specifics>

overall_integrity: <HIGH|MEDIUM|LOW>
```

### Phase 5: Present Report

```
EZRA RECONCILIATION
═══════════════════════════════════════════
Plan: <name> (created <date>)

Completion: <percentage>%
  ✅ Complete:  <n> items
  🔶 Partial:   <n> items
  ❌ Missing:   <n> items
  ⏭️  Skipped:   <n> items

Unplanned Changes: <n> files
  <list top 5 with classification>

Constraint Violations: <n>
  <list any violations>

Plan Integrity: <HIGH/MEDIUM/LOW>

Recommended Actions:
  1. <action for missing items>
  2. <action for unplanned changes>
  3. <action for violations>
═══════════════════════════════════════════
```

Update the plan file with current statuses.

Execute automatically. Do not ask for confirmation before starting analysis.
