---
tier: core
name: ezra:decide
description: Record an architectural decision (ADR) with rationale, enforcement rules, and affected paths. Decisions become governance rules that EZRA enforces.
---

You are recording an EZRA architectural decision.

If `.ezra/` does not exist, tell the user to run `/ezra:init` first and stop.

## Input

The user will describe a decision either as $ARGUMENTS or in conversation. Examples:
- `/ezra:decide Use PostgreSQL as the primary database`
- `/ezra:decide All API routes must validate input with Zod schemas`
- `/ezra:decide Authentication uses JWT with RS256 signing`

If no arguments provided, ask: "What architectural decision do you want to record?"

## Decision Record Creation

Determine the next decision ID by counting files in `.ezra/decisions/`.

Create `.ezra/decisions/ADR-<NNN>.yaml`:

```yaml
# .ezra/decisions/ADR-<NNN>.yaml
id: ADR-<NNN>
status: ACTIVE  # ACTIVE | SUPERSEDED | DEPRECATED | PROPOSED
date: <ISO timestamp>
category: <infer from content: ARCHITECTURE | DATABASE | SECURITY | API | TESTING | INFRASTRUCTURE | DEPENDENCY | CONVENTION>

decision: <one clear sentence stating the decision>

context: |
  <Why this decision was made. Infer from the user's description
  and current codebase state. Reference specific files or patterns
  if relevant.>

rationale: |
  <Why this choice over alternatives. If the user didn't state
  alternatives, infer reasonable ones and explain why this was chosen.>

consequences:
  positive:
    - <benefit 1>
    - <benefit 2>
  negative:
    - <tradeoff 1>
    - <tradeoff 2>
  risks:
    - <risk if not followed>

enforcement:
  # How EZRA should check compliance
  affected_paths:
    - <glob patterns of files this decision affects>
  check_description: |
    <Natural language description of what compliance looks like.
    This is what ezra-guardian will verify during scans.>
  auto_enforced: <true if a hook can verify this, false if manual review needed>

supersedes: <ADR-NNN if this replaces a previous decision, otherwise null>
```

## Governance Integration

After creating the decision file:

1. If the decision defines new protected paths, add them to `.ezra/governance.yaml → protected_paths`
2. If the decision defines new standards, add them to `.ezra/governance.yaml → standards`
3. Update `.ezra/knowledge.yaml` if the decision changes architectural understanding

## Report

```
EZRA DECISION RECORDED
═══════════════════════════════════════════
ID: ADR-<NNN>
Category: <category>
Status: ACTIVE

Decision: <text>

Rationale: <summary>

Enforcement:
  Affected paths: <list>
  Auto-enforced: <yes/no>
  Check: <description>

Governance updated: <yes/no — what changed>
═══════════════════════════════════════════
Total decisions: <count> active, <count> superseded
```

Execute automatically. Infer as much as possible from context. Only ask the user for clarification if the decision is genuinely ambiguous.

## Deprecation

If the user says `/ezra:decide --deprecate ADR-NNN`:

1. Look up `ADR-NNN` in `.ezra/decisions/`
2. Show the decision title and ask: "This will mark ADR-NNN as DEPRECATED. Type 'deprecate' to confirm."
3. Only proceed if user types exactly 'deprecate'
4. Set `status: DEPRECATED` and add `deprecated_date: <ISO timestamp>`
5. Confirm deprecation

## Suggested Next Steps

After recording a decision, suggest:
- Run `/ezra:guard` to verify the new decision is enforced
- Run `/ezra:scan` to check impact across the codebase
- Run `/ezra:reconcile` if this changes an existing plan
