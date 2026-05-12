---
tier: core
name: ezra:status
description: Show EZRA governance health — decisions, violations, drift, scan history, and plan status.
---

You are displaying the EZRA governance status dashboard.

If `.ezra/` does not exist:
```
EZRA STATUS: NOT INITIALIZED
Run /ezra:init to set up governance for this project.
```
Stop here.

## Gather State

Read the following files:
1. `.ezra/governance.yaml` — configuration and rules
2. `.ezra/knowledge.yaml` — codebase knowledge
3. `.ezra/decisions/` — count and categorize all decision files
4. `.ezra/scans/` — find most recent scan, count total scans
5. `.ezra/plans/` — count active plans, check completion status

## Present Dashboard

```
EZRA GOVERNANCE STATUS
═══════════════════════════════════════════
Project: <name>
Language: <lang> | Framework: <framework>
Architecture: <pattern>
Knowledge Confidence: <INITIAL | LOW | MEDIUM | HIGH>

DECISIONS
  Active:      <count>
  Superseded:  <count>
  Deprecated:  <count>
  By category: <category>: <count>, <category>: <count>, ...

LAST SCAN
  Date: <date or "Never — run /ezra:scan">
  Health Score: <score>/100
  Critical: <n> | High: <n> | Medium: <n> | Low: <n>

PLANS
  Active: <count>
  Completion: <average %>
  <list each plan name and completion %>

PROTECTED PATHS: <count> configured
GOVERNANCE RULES: <count> active

RECENT ACTIVITY
  <last 5 decision records or scan results, most recent first>

RECOMMENDED NEXT ACTIONS
  <based on current state, suggest 1-3 actions>
═══════════════════════════════════════════
```

Recommended actions logic:
- No scans ever → "Run /ezra:scan for initial analysis"
- Last scan > 7 days old → "Run /ezra:scan — last scan is stale"
- 0 decisions → "Run /ezra:decide to record architectural decisions"
- Active plans with < 50% completion → "Run /ezra:reconcile to check plan progress"
- Recent scan had CRITICAL findings → "Address <n> critical findings from last scan"

Execute automatically. No confirmation needed.
