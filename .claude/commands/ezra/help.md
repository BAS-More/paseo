---
tier: core
name: ezra:help
description: Show all EZRA commands, agents, and current configuration.
---

Display the following help text:

```
EZRA (עזרא) — The Scribe Who Restores and Enforces Standards
═══════════════════════════════════════════════════════════════
Enforce. Zero-drift. Restore. Audit.

COMMANDS (45 total — 8 core, 8 advanced, 29 admin)

── CORE (start here) ──────────────────────────────────────────
  /ezra:init          Initialize EZRA for this project
  /ezra:scan          Multi-agent codebase scan (100 agents, presets)
  /ezra:review        Multi-agent code review (smart agent selection)
  /ezra:decide        Record an architectural decision (ADR)
  /ezra:guard         Check changes against governance rules
  /ezra:status        Quick governance health snapshot
  /ezra:health        Deep 5-pillar health assessment (0-100)
  /ezra:help          This help text

── ADVANCED (power users) ─────────────────────────────────────
  /ezra:advisor       Proactive best-practice advisor
  /ezra:plan          Holistic planning engine
  /ezra:doc           Create and manage SDLC documents
  /ezra:doc-check     Document gap analysis by project phase
  /ezra:dash          Real-time project dashboard
  /ezra:reconcile     Compare plan vs implementation
  /ezra:workflow      Enhanced workflow template system
  /ezra:agents        Agent management — list, recommend, deploy (100 roles)
  /ezra:process       Development process engine (create, run, edit workflows)
  /ezra:auto          Autonomous execution engine with guard rails
  /ezra:multi         Multi-project orchestration
  /ezra:version       Version control for governance state
  /ezra:settings      Interactive settings manager

── ADMIN (run /ezra:help --all for details) ───────────────────
  Setup:      bootstrap, install, interview
  Docs:       doc-sync, doc-approve, claude-md
  Decisions:  decide-graph, compliance
  Monitoring: oversight, version, progress, pm
  Automation: auto, process, multi, sync
  Knowledge:  learn, library, research, memory
  Portfolio:  portfolio, cost, handoff, report
  Admin:      license, assess, token-shield, git-hooks

UNINSTALL
  npx ezra-claude-code --uninstall --global   Remove global install
  npx ezra-claude-code --uninstall --local    Remove local install
  /ezra:install uninstall                     Interactive uninstall

AGENT SYSTEM (100 roles × 12 domains × 4 core engines)
  Core Engines:
    ezra-architect    Architecture analysis, layer mapping, dependency tracing
    ezra-reviewer     Security + quality review with severity scoring
    ezra-guardian     Decision enforcement, protected path integrity
    ezra-reconciler   Plan vs implementation comparison

  Domains (100 specialized roles):
    architecture(10) security(12) quality(10) testing(8)
    governance(8)    devops(10)   documentation(8) performance(8)
    accessibility(6) data(6)     frontend(8)  reconciliation(6)

  Presets: quick-review(3) full-scan(4) security-deep(6) quality-deep(6)
           frontend-review(6) backend-review(6) pre-release(8) maximum-coverage(12)

  Quick Start:
    /ezra:agents                  → Interactive agent menu
    /ezra:agents recommend <task> → Get recommendation for any task
    /ezra:scan --preset <name>    → Scan with preset team
    /ezra:review --agents 6       → Review with 6 smart-selected agents

STATE DIRECTORY: .ezra/
  decisions/         Architectural Decision Records (YAML)
  scans/             Timestamped scan results
  plans/             Registered plans for reconciliation
  governance.yaml    Rules, protected paths, enforcement config
  knowledge.yaml     Codebase knowledge — what EZRA knows

TYPICAL WORKFLOW
  1. /ezra:init              → Set up governance
  2. /ezra:decide <decision> → Record key decisions
  3. /ezra:scan              → Baseline analysis
  4. ... do work ...
  5. /ezra:guard             → Check before committing
  6. /ezra:review            → Deep review before PR
  7. /ezra:reconcile         → Verify plan completion
  8. /ezra:status            → Ongoing health check

PHILOSOPHY
  Ezra didn't suggest. He governed.
  EZRA handles multi-phase analysis, decision tracking,
  document lifecycle, and integrity enforcement.
  You focus on building.
```

Then check if `.ezra/` exists and append current state:

If initialized:
```
CURRENT PROJECT: <name>
Decisions: <count> active | Scans: <count> total | Plans: <count> active
Last scan: <date> | Health: <score>/100
```

If not initialized:
```
STATUS: Not initialized. Run /ezra:init to begin.
```
