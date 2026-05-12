---
tier: core
name: ezra:guard
description: Check staged or recent changes against EZRA governance rules. Detects protected path violations, decision non-compliance, and standard deviations.
---

You are running an EZRA governance guard check on recent changes.

First, read `.ezra/governance.yaml` and `.ezra/decisions/` to load rules.

If `.ezra/` does not exist, tell the user to run `/ezra:init` first and stop.

## Step 1: Identify Changes

Detect what has changed using git:

```bash
# Staged changes
git diff --cached --name-only

# If nothing staged, check unstaged
git diff --name-only

# If nothing unstaged, check last commit
git diff HEAD~1 --name-only
```

List all changed files.

## Step 2: Protected Path Check

For each changed file, check against `governance.yaml → protected_paths`:
- If a changed file matches a protected pattern, check if a corresponding decision record exists in `.ezra/decisions/` that authorises the change
- If no decision exists → flag as **VIOLATION**
- If a decision exists → flag as **AUTHORISED**

## Step 3: Decision Compliance Check

For each decision in `.ezra/decisions/`:
- Check if the code still complies with the decision
- Focus only on files that were changed (not full codebase — that's what `/ezra:scan` is for)
- If a change contradicts a recorded decision → flag as **CONFLICT**

## Step 4: Standards Check

Apply standards from `governance.yaml → standards` to changed files only:
- `strict_types`: Check for `any` types in changed TypeScript files
- `no_any`: Check for explicit `any` annotations
- Custom standards if configured

## Step 5: Report

Present results:

```
EZRA GUARD CHECK
═══════════════════════════════════════════
Files Changed: <count>
Protected Path Hits: <count>
Decision Conflicts: <count>
Standard Violations: <count>

PROTECTED PATHS:
  ✅ AUTHORISED: <file> (Decision: <ID>)
  ❌ VIOLATION: <file> — <reason>
     → Action: Run /ezra:decide to record a decision

DECISION COMPLIANCE:
  ✅ <decision ID>: Compliant
  ❌ <decision ID>: CONFLICT — <description>
     → Action: Update decision or revert change

STANDARDS:
  ✅ All standards met
  ❌ <file>:<line> — <violation>

Overall: <PASS / FAIL>
═══════════════════════════════════════════
```

If everything passes: "EZRA guard: All clear. Changes are governance-compliant."
If violations found: List each with a specific remediation action.

Execute automatically. Do not ask for confirmation.
