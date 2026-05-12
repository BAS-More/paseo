---
tier: core
name: ezra:scan
description: "Dynamic multi-agent codebase scan. Recommends optimal agents from 100 roles, or use presets. Usage: /ezra:scan (interactive), /ezra:scan --preset <name>, /ezra:scan --agents <count>, /ezra:scan --classic (original 4-agent scan). Results saved to .ezra/scans/."
---

You are running an EZRA deep scan. This is a multi-phase, multi-agent analysis of the codebase.

First, read `.ezra/knowledge.yaml` and `.ezra/governance.yaml` to understand current state.

If `.ezra/` does not exist, tell the user to run `/ezra:init` first and stop.

## Pre-Scan: Agent Selection

Read the agent registry from `agents/registry.yaml` (or `~/.claude/agents/registry.yaml` if installed globally).

Parse `$ARGUMENTS` to determine scan mode:

- `/ezra:scan --classic` → Use original 4-agent scan (Phase 1-4 below)
- `/ezra:scan --preset <name>` → Use a preset from the registry (e.g., `full-scan`, `security-deep`, `pre-release`)
- `/ezra:scan --agents <count>` → Recommend and deploy N agents
- `/ezra:scan --roles <id1,id2,...>` → Deploy specific roles by ID
- `/ezra:scan` (no args) → **Interactive agent selection** (below)

### Interactive Agent Selection (default)

When no arguments provided, present:

```
EZRA SCAN — AGENT SELECTION
═══════════════════════════════════════════════════════
EZRA has 100 specialized agents across 12 domains.

How many agents should I deploy for this scan?

  Presets:
  [1] Quick Review     — 3 agents  (architecture + security + quality)
  [2] Full Scan        — 4 agents  (classic: architect, reviewer, guardian, reconciler)
  [3] Security Deep    — 6 agents  (OWASP, auth, injection, supply chain, secrets, privacy)
  [4] Quality Deep     — 6 agents  (types, complexity, DRY, dead code, SOLID, patterns)
  [5] Pre-Release      — 8 agents  (security, quality, testing, performance, docs, governance)
  [6] Maximum Coverage — 12 agents (all 12 domains represented)
  [7] Custom           — Choose your own agents

  Or enter a number (2-20) and I'll recommend the best team.
  Or describe what you want to focus on.

═══════════════════════════════════════════════════════
```

Based on user response:
- Number 1-6 → Use the corresponding preset
- Number 7 → Show domain list, let user pick roles
- A plain number (2-20) → Recommend top N agents for a general codebase scan
- Text description → Match against registry tags/specialties, recommend optimal team

After selection, confirm the team:

```
DEPLOYING <N> AGENTS:
  1. <role-name> (<domain>) — <specialty summary>
  2. <role-name> (<domain>) — <specialty summary>
  ...

Proceed? [Y/n]
```

### Dynamic Phase Dispatch

For each selected agent role, construct and dispatch a phase:

1. Look up the role in the registry
2. Get the `base_agent` (one of: ezra-architect, ezra-reviewer, ezra-guardian, ezra-reconciler)
3. Construct the brief using the role's `specialty` and `best_for`:

   "You are operating as the EZRA {role.name} ({role.id}).
   Your specialty: {role.specialty}
   Focus your analysis on: {role.best_for}
   Apply your core capabilities as {role.base_agent} but NARROW your focus to your specialty area.
   The full team includes: {all role names}
   Do not duplicate findings from other team members.
   Output as structured YAML with severity ratings."

4. Dispatch the subagent using the `base_agent` engine
5. Collect structured YAML output

Dispatch agents sharing different base engines in parallel. Dispatch sequentially when multiple roles share the same base engine.

---

## Classic Phases (used with --classic flag or preset "full-scan")

### Phase 1: Architecture Scan (Agent: ezra-architect)

Dispatch the `ezra-architect` subagent with this brief:

"Analyze the codebase architecture. Read the project entry points, directory structure, and key modules. Produce a structured report covering:
1. **Layer Map**: What architectural layers exist and how they connect
2. **Dependency Graph**: Key internal module dependencies (which modules import which)
3. **External Integration Points**: APIs, databases, caches, queues, third-party services
4. **Pattern Compliance**: Does the code follow consistent patterns or are there deviations
5. **Complexity Hotspots**: Files or modules with highest complexity or coupling
6. **Architecture Drift**: Any deviations from the documented/intended architecture

Output as structured YAML."

### Phase 2: Quality & Security Scan (Agent: ezra-reviewer)

Dispatch the `ezra-reviewer` subagent with this brief:

"Perform a code quality and security review of the codebase. Focus on:
1. **Type Safety**: Any use of `any`, untyped interfaces, missing return types
2. **Error Handling**: Uncaught promises, missing try/catch, generic error swallowing
3. **Security**: Hardcoded secrets, SQL injection vectors, XSS risks, missing input validation, OWASP Top 10 checks
4. **Test Coverage Gaps**: Modules or functions without corresponding tests
5. **Dead Code**: Unused exports, unreachable branches, commented-out code
6. **Dependency Health**: Outdated packages, known vulnerabilities, unnecessary dependencies

Output as structured YAML with severity ratings (CRITICAL/HIGH/MEDIUM/LOW)."

### Phase 3: Governance Compliance (Agent: ezra-guardian)

Dispatch the `ezra-guardian` subagent with this brief:

"Check governance compliance against .ezra/governance.yaml and .ezra/decisions/. Verify:
1. **Decision Compliance**: Are all recorded architectural decisions being followed in the code?
2. **Protected Path Integrity**: Have any protected paths been modified without a corresponding decision record?
3. **Standard Adherence**: Does the code meet the configured standards (strict types, no any, coverage minimum)?
4. **Drift Detection**: Compare current codebase state against .ezra/knowledge.yaml — what has changed since last scan?

Output as structured YAML with violation details."

### Phase 4: Reconciliation Check (Agent: ezra-reconciler)

If any files exist in `.ezra/plans/`, dispatch the `ezra-reconciler` subagent:

"Compare registered plans in .ezra/plans/ against the current codebase. For each plan:
1. Which planned items have been implemented?
2. Which planned items are missing or incomplete?
3. Were any unplanned changes introduced?
4. What is the overall plan completion percentage?

Output as structured YAML."

If no plans exist, skip this phase and note "No plans registered for reconciliation."

## Phase 5: Aggregate & Persist

Combine all agent outputs into a single scan report. Save to `.ezra/scans/<ISO-date>-scan.yaml`:

```yaml
# .ezra/scans/YYYY-MM-DDTHH-MM-SS-scan.yaml
timestamp: <ISO>
phases_completed: [architecture, quality_security, governance, reconciliation]

architecture:
  <architect agent output>

quality_security:
  findings_by_severity:
    critical: <count>
    high: <count>
    medium: <count>
    low: <count>
  <reviewer agent output>

governance:
  compliant: <true/false>
  violations: <count>
  <guardian agent output>

reconciliation:
  <reconciler agent output or "no_plans_registered">

summary:
  health_score: <calculated 0-100>
  top_risks: <top 3 findings>
  recommended_actions: <top 3 next steps>
```

Update `.ezra/knowledge.yaml` with any new discoveries.

## Phase 6: Present Report

Present a compact summary to the user:

```
EZRA SCAN COMPLETE
═══════════════════════════════════════════
Timestamp: <date>
Health Score: <score>/100

Architecture:  <1-line summary>
Quality:       <critical>C <high>H <medium>M <low>L findings
Governance:    <compliant/violations found>
Reconciliation: <status>

Top Risks:
  1. <risk>
  2. <risk>
  3. <risk>

Recommended Actions:
  1. <action>
  2. <action>
  3. <action>

Full report: .ezra/scans/<filename>
═══════════════════════════════════════════
```

Execute all phases automatically without asking for confirmation. Use subagents for parallel execution where possible.

## Suggested Next Steps

After a scan, suggest:
- Run `/ezra:review` for deep code review of flagged files
- Run `/ezra:guard` before committing to verify compliance
- Run `/ezra:health` for a pillar-by-pillar breakdown
