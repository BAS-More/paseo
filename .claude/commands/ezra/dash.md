---
tier: advanced
name: ezra:dash
description: "Real-time project status dashboard. Shows phase, health, documents, decisions, risks, tests, deployment, and blockers at a glance. Run anytime for instant situational awareness."
---

You are rendering the EZRA project dashboard — a single-screen view of everything that matters.

If `.ezra/` does not exist, tell the user to run `/ezra:init` first and stop.

## Data Collection

Read ALL of the following in parallel. If a file doesn't exist, mark that section as "NOT CONFIGURED":

1. `.ezra/governance.yaml` — project name, phase, standards
2. `.ezra/knowledge.yaml` — architecture, confidence, last scan
3. `.ezra/docs/registry.yaml` — document inventory
4. `.ezra/decisions/` — count all, group by status and category
5. `.ezra/scans/` — find most recent scan, extract health score and findings
6. `.ezra/plans/` — active plans, completion percentages
7. `package.json` — version, dependencies count, scripts
8. `tsconfig.json` / project config — strictness settings
9. `.github/workflows/` or CI config — pipeline status
10. Git state:
    ```bash
    git log --oneline -5 2>/dev/null
    git status --porcelain 2>/dev/null | wc -l
    git branch --show-current 2>/dev/null
    git stash list 2>/dev/null | wc -l
    ```
11. Test state (try each, use whichever works):
    ```bash
    # Don't RUN tests — just check last known results if available
    # Look for coverage reports, test result files
    ls coverage/coverage-summary.json 2>/dev/null
    ls test-results.json 2>/dev/null
    ls .ezra/scans/*scan.yaml 2>/dev/null | tail -1
    ```
12. Node modules health:
    ```bash
    npm audit --json 2>/dev/null | head -5
    ```

## Dashboard Render

Present this EXACT layout, filling in real data. Use box-drawing characters for structure. Every section must show real data or "—" if unavailable. Never show placeholder text.

```
╔══════════════════════════════════════════════════════════════════════╗
║  EZRA DASHBOARD — <Project Name>                                   ║
║  <ISO date/time>                                                    ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  PHASE: <phase>          STATUS: <status>        HEALTH: <score>/100 ║
║  Branch: <branch>        Uncommitted: <n> files  Stashes: <n>       ║
║  Version: <from package.json or "unversioned">                       ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║  ARCHITECTURE                                                        ║
║  ├─ Language:    <lang> <version>                                    ║
║  ├─ Framework:   <framework>                                         ║
║  ├─ Pattern:     <architecture pattern>                              ║
║  ├─ Database:    <db type>                                           ║
║  ├─ Deployment:  <where it runs>                                     ║
║  └─ Confidence:  <INITIAL|LOW|MEDIUM|HIGH>                           ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║  GOVERNANCE          ║  DOCUMENTS                                    ║
║  ┌─────────────────┐ ║  ┌────────────────────────────────────┐       ║
║  │ Decisions:  <n>  │ ║  │ Coverage: <n>/<total> (<pct>%)     │       ║
║  │  ACTIVE:    <n>  │ ║  │  Pre-Dev:   <n>/<t> ██████░░ <p>% │       ║
║  │  SUPERSEDED:<n>  │ ║  │  Dev:       <n>/<t> ████░░░░ <p>% │       ║
║  │                  │ ║  │  Post-Dev:  <n>/<t> ██░░░░░░ <p>% │       ║
║  │ Protected Paths: │ ║  │                                    │       ║
║  │  Configured: <n> │ ║  │ Critical Gaps: <n>                 │       ║
║  │                  │ ║  │  <top 3 missing CRITICAL docs>     │       ║
║  │ Standards:       │ ║  │                                    │       ║
║  │  Strict TS: <✓/✗>│ ║  │ Stale (30d+): <n>                 │       ║
║  │  No Any:    <✓/✗>│ ║  │  <top 3 stale docs>               │       ║
║  │  Coverage:  <n>% │ ║  │                                    │       ║
║  └─────────────────┘ ║  └────────────────────────────────────┘       ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║  RISKS & BLOCKERS                                                    ║
║  ┌──────────────────────────────────────────────────────────────┐    ║
║  │ Open: <n>  │  Managed: <n>  │  Closed: <n>                  │    ║
║  │                                                              │    ║
║  │ 🔴 CRITICAL: <list any critical risks — 1 line each>        │    ║
║  │ 🟠 HIGH:     <list any high risks — 1 line each>            │    ║
║  │ 🟡 OPEN:     <remaining open risks count>                   │    ║
║  │                                                              │    ║
║  │ Top Blocker: <most critical blocker or "None">               │    ║
║  └──────────────────────────────────────────────────────────────┘    ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║  SCAN FINDINGS (Last: <date or "Never">)                             ║
║  ┌──────────────────────────────────────────────────────────────┐    ║
║  │ 🔴 Critical: <n>  🟠 High: <n>  🟡 Medium: <n>  🔵 Low: <n>│    ║
║  │                                                              │    ║
║  │ Architecture: <1-line summary>                               │    ║
║  │ Security:     <1-line summary>                               │    ║
║  │ Quality:      <1-line summary>                               │    ║
║  │ Governance:   <COMPLIANT / n violations>                     │    ║
║  └──────────────────────────────────────────────────────────────┘    ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║  PLANS & PROGRESS                                                    ║
║  ┌──────────────────────────────────────────────────────────────┐    ║
║  │ Active Plans: <n>                                            │    ║
║  │                                                              │    ║
║  │ <plan name>    ████████░░░░ 67%  (8/12 items)               │    ║
║  │ <plan name>    ██░░░░░░░░░ 15%  (3/20 items)               │    ║
║  │                                                              │    ║
║  │ Last 5 Commits:                                              │    ║
║  │  <hash> <message>                                            │    ║
║  │  <hash> <message>                                            │    ║
║  │  <hash> <message>                                            │    ║
║  │  <hash> <message>                                            │    ║
║  │  <hash> <message>                                            │    ║
║  └──────────────────────────────────────────────────────────────┘    ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║  DEPENDENCIES & SECURITY                                             ║
║  ┌──────────────────────────────────────────────────────────────┐    ║
║  │ Packages: <n> deps / <n> devDeps                             │    ║
║  │ Audit: <critical> critical / <high> high / <moderate> mod    │    ║
║  │ Outdated: <n if known, or "Run npm outdated to check">      │    ║
║  └──────────────────────────────────────────────────────────────┘    ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║  RECOMMENDED ACTIONS                                                 ║
║  ┌──────────────────────────────────────────────────────────────┐    ║
║  │ 1. <most important action based on all data above>           │    ║
║  │ 2. <next most important>                                     │    ║
║  │ 3. <next>                                                    │    ║
║  │ 4. <next>                                                    │    ║
║  │ 5. <next>                                                    │    ║
║  └──────────────────────────────────────────────────────────────┘    ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

## Recommended Actions Logic

Generate the top 5 actions by priority:

1. **CRITICAL risks** → "Resolve critical risk: <description>"
2. **CRITICAL missing docs** → "Create <doc type> — required for <phase>"
3. **Scan findings** → "Address <n> critical scan findings"
4. **Stale docs** → "Update <doc> — stale since <date>"
5. **Low health score** → "Run /ezra:scan — health score below 50"
6. **No recent scan** → "Run /ezra:scan — no scan in 7+ days"
7. **Plan gaps** → "Complete <plan> — <n> items remaining"
8. **Governance violations** → "Resolve <n> governance violations"
9. **Audit vulnerabilities** → "Fix <n> npm audit vulnerabilities"
10. **Decision gaps** → "Record decision for <unrecorded pattern>"

Pick the top 5 most impactful, deduplicated.

## Progress Bar Helper

For document coverage and plan progress, render progress bars:

```
0%   ░░░░░░░░░░
25%  ███░░░░░░░
50%  █████░░░░░
75%  ████████░░
100% ██████████
```

Each █ = 10%. Round to nearest 10%.

## Rules

- Execute immediately. No confirmation needed.
- Every field must show real data or "—" if unavailable. Never show template text.
- If data sources are missing, show the section with "NOT CONFIGURED — run /ezra:init"
- Keep the dashboard to a single screen where possible — conciseness is critical.
- The dashboard is READ-ONLY. It never modifies state.
