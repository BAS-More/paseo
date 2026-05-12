---
tier: core
name: ezra:health
description: "Comprehensive project health enforcement across 5 pillars: On-Track, No Gaps, Clean, Secure, Best Practices. Scores each pillar 0-100 and provides actionable remediation. Run regularly to prevent drift."
---

You are running the EZRA Health Enforcement Engine — the system that ensures the project stays on track, gap-free, clean, secure, and within best practices.

If `.ezra/` does not exist, tell the user to run `/ezra:init` first and stop.

## The 5 Pillars

EZRA Health evaluates the project against 5 non-negotiable pillars. Each pillar scores 0-100. The overall health score is the weighted average.

| Pillar | Weight | What It Measures |
|--------|--------|-----------------|
| ON-TRACK | 25% | Plans progressing, decisions recorded, milestones met, no stalled work |
| NO GAPS | 20% | Document coverage, missing critical docs, untested code, undocumented APIs |
| CLEAN | 15% | Code quality, dead code, type safety, linting, consistent patterns |
| SECURE | 25% | OWASP compliance, secrets handling, auth patterns, dependency vulnerabilities |
| BEST PRACTICES | 15% | SOLID, ISO 25010, coding standards, git hygiene, CI/CD, error handling |

## Data Collection

Read ALL of the following before scoring:

1. `.ezra/governance.yaml` — rules and standards
2. `.ezra/knowledge.yaml` — architecture and confidence
3. `.ezra/decisions/` — all decisions
4. `.ezra/docs/registry.yaml` — document inventory
5. `.ezra/docs/.drift-counter.json` — edits since last sync
6. `.ezra/docs/proposals/` — pending proposals
7. `.ezra/scans/` — most recent scan results
8. `.ezra/plans/` — active plans and completion
9. `.ezra/versions/changelog.yaml` — recent activity
10. `.ezra/versions/current.yaml` — version state

Also analyze the actual codebase:

```bash
# Git health
git log --oneline -20 2>/dev/null
git status --porcelain 2>/dev/null
git stash list 2>/dev/null
git branch -a 2>/dev/null

# Dependency health
npm audit --json 2>/dev/null
npm outdated --json 2>/dev/null

# TypeScript strictness
cat tsconfig.json 2>/dev/null

# Linting
cat .eslintrc* .eslintrc.json .eslintrc.js 2>/dev/null
cat .prettierrc* 2>/dev/null

# Test coverage
cat coverage/coverage-summary.json 2>/dev/null

# CI/CD
ls .github/workflows/*.yml 2>/dev/null
ls .github/workflows/*.yaml 2>/dev/null

# Secrets scan (simple check)
grep -rn "password\s*=\s*[\"']" src/ --include="*.ts" --include="*.js" -l 2>/dev/null
grep -rn "secret\s*=\s*[\"']" src/ --include="*.ts" --include="*.js" -l 2>/dev/null
grep -rn "api.key\|apiKey\|API_KEY" src/ --include="*.ts" --include="*.js" -l 2>/dev/null

# Code quality indicators
find src/ -name "*.ts" -exec grep -l ": any" {} \; 2>/dev/null | wc -l
find src/ -name "*.ts" -exec grep -l "as any" {} \; 2>/dev/null | wc -l
find src/ -name "*.ts" -exec grep -l "// TODO" {} \; 2>/dev/null | wc -l
find src/ -name "*.ts" -exec grep -l "eslint-disable" {} \; 2>/dev/null | wc -l

# Error handling
find src/ -name "*.ts" -exec grep -l "catch\s*{" {} \; 2>/dev/null | wc -l
find src/ -name "*.ts" -exec grep -l "catch\s*(\s*)" {} \; 2>/dev/null | wc -l

# Test existence
find src/ -name "*.ts" ! -name "*.test.ts" ! -name "*.spec.ts" -type f 2>/dev/null | wc -l
find src/ -name "*.test.ts" -o -name "*.spec.ts" -type f 2>/dev/null | wc -l
```

## Pillar 1: ON-TRACK (25%)

Score based on:

| Check | Points | Condition |
|-------|--------|-----------|
| Active plans exist | 15 | At least 1 plan registered in `.ezra/plans/` |
| Plans progressing | 20 | Average plan completion > 30% (or recent items marked complete) |
| No stalled plans | 15 | No plan at 0% completion for 7+ days |
| Decisions being recorded | 15 | At least 1 decision recorded in last 14 days, or total > 5 |
| Recent scans | 10 | Last scan within 7 days |
| Version activity | 10 | Changelog entries in last 7 days |
| No orphan proposals | 15 | Pending proposals < 5, or all < 7 days old |

Deductions:
- -20 if a plan has been stalled > 14 days
- -15 if no scan has ever been run
- -10 if > 10 pending proposals unreviewed
- -10 if no decisions recorded at all

### Findings Format

```yaml
on_track:
  score: <0-100>
  checks:
    - name: "Active plans"
      status: PASS | WARN | FAIL
      detail: "<specifics>"
      remediation: "<what to do>"
  deductions:
    - reason: "<why points were removed>"
      points: <n>
```

## Pillar 2: NO GAPS (20%)

Score based on:

| Check | Points | Condition |
|-------|--------|-----------|
| Critical docs exist | 25 | All 7 CRITICAL document types present |
| Phase-appropriate docs | 20 | MUST HAVE docs for current phase present |
| Doc freshness | 15 | No MUST HAVE docs stale > 30 days |
| Test file coverage | 15 | Every source directory has corresponding test files |
| API documentation | 10 | API routes have corresponding docs |
| Decision coverage | 15 | Major patterns/tools in codebase have ADRs |

Deductions:
- -5 per missing CRITICAL document
- -3 per missing MUST HAVE document
- -2 per STALE MUST HAVE document
- -10 if test directories missing entirely
- -5 if no API documentation and API routes exist

### Gap Detection Logic

For "Decision coverage": scan the codebase for major patterns that lack ADRs:
- Database choice used in code but no ADR
- Auth strategy implemented but no ADR
- Framework choice but no ADR
- Cloud provider / deployment target but no ADR
- Major npm packages (ORM, test framework, build tool) without ADRs

## Pillar 3: CLEAN (15%)

Score based on:

| Check | Points | Condition |
|-------|--------|-----------|
| No `any` types | 20 | Zero files with `: any` or `as any` in TypeScript |
| No TODOs in code | 10 | Zero or < 5 TODO/FIXME/HACK comments |
| No eslint-disable | 10 | Zero or < 3 eslint-disable directives |
| Linter configured | 10 | ESLint/Prettier/Biome config exists |
| Strict TypeScript | 15 | `strict: true` in tsconfig.json |
| No dead code | 10 | No commented-out code blocks (> 3 lines) |
| Consistent patterns | 15 | Architecture scan shows HIGH consistency |
| No empty catch blocks | 10 | Zero empty catch blocks or catch-without-handling |

Deductions:
- -2 per file with `any` types (cap at -20)
- -1 per TODO/FIXME (cap at -10)
- -5 if no linter configured
- -10 if `strict: false` or missing in tsconfig
- -3 per empty catch block (cap at -15)
- -5 if eslint-disable count > 10

## Pillar 4: SECURE (25%)

Score based on:

| Check | Points | Condition |
|-------|--------|-----------|
| No hardcoded secrets | 20 | Zero password/secret/key literals in source |
| Dependency audit clean | 20 | Zero critical/high npm audit findings |
| Auth patterns present | 15 | Authentication middleware/guards exist |
| Input validation | 10 | Validation library used (Zod, Joi, class-validator) |
| CORS configured | 5 | CORS middleware configured (not wildcard *) |
| Helmet/security headers | 5 | Security header middleware present |
| .env not committed | 10 | .env in .gitignore, no .env files tracked |
| Security ADR exists | 10 | `security-arch` document or security-category ADR present |
| Rate limiting | 5 | Rate limiter middleware configured |

Deductions:
- -25 per hardcoded secret found (cap at -50, this is catastrophic)
- -5 per critical npm audit vulnerability
- -3 per high npm audit vulnerability
- -15 if no authentication at all and API routes exist
- -10 if .env file is committed to git
- -5 if CORS is wildcard `*` in production config

## Pillar 5: BEST PRACTICES (15%)

Score based on:

| Check | Points | Condition |
|-------|--------|-----------|
| CI/CD configured | 15 | GitHub Actions/Azure Pipelines/etc config exists |
| Git branching strategy | 10 | Multiple branches exist, not just main |
| Commit messages | 10 | Last 10 commits follow conventional format or are descriptive |
| Error handling patterns | 15 | Structured error handling (custom error classes, error middleware) |
| SOLID indicators | 15 | Single-responsibility (files < 300 lines avg), dependency injection patterns |
| Environment separation | 10 | Separate configs for dev/staging/prod |
| Logging structured | 10 | Logging library used (winston, pino, etc.), not console.log in production |
| README exists | 5 | README.md present and > 20 lines |
| CLAUDE.md exists | 5 | CLAUDE.md or equivalent project instructions |
| Package scripts | 5 | build, test, lint scripts defined in package.json |

Deductions:
- -15 if no CI/CD at all
- -5 if main/master is the only branch
- -10 if console.log used in production code (> 10 instances)
- -5 if no error handling middleware
- -5 per file > 500 lines (cap at -15)

## Scoring Algorithm

```
overall_health = (
  on_track_score * 0.25 +
  no_gaps_score * 0.20 +
  clean_score * 0.15 +
  secure_score * 0.25 +
  best_practices_score * 0.15
)
```

Minimum score per pillar: 0. Maximum: 100. Overall: 0-100.

### Health Grade

| Score | Grade | Meaning |
|-------|-------|---------|
| 90-100 | A | Excellent — production-ready, well-governed |
| 75-89 | B | Good — minor issues, safe to ship |
| 60-74 | C | Acceptable — needs attention before release |
| 40-59 | D | Poor — significant risks, do not ship |
| 0-39 | F | Critical — stop and remediate immediately |

## Report

```
EZRA HEALTH ENFORCEMENT REPORT
═══════════════════════════════════════════════════════════════════════

OVERALL: <score>/100 — Grade <grade>    <emoji based on grade>

    ON-TRACK      ████████░░  78/100
    NO GAPS       ██████░░░░  55/100
    CLEAN         █████████░  92/100
    SECURE        ███████░░░  68/100
    BEST PRACTICE ████████░░  81/100

═══════════════════════════════════════════════════════════════════════

PILLAR 1: ON-TRACK (78/100)                                    Weight: 25%
───────────────────────────────────────────────────────────────────────
  ✅ Active plans: 2 plans registered
  ✅ Plan progress: mvp-plan 67%, auth-plan 45%
  ✅ Decisions: 12 active (last recorded 2 days ago)
  ⚠️  Last scan: 9 days ago — should be within 7 days
      → Run /ezra:scan
  ✅ Version activity: 8 changes this week
  ⚠️  Pending proposals: 3 unreviewed
      → Run /ezra:doc-approve

PILLAR 2: NO GAPS (55/100)                                     Weight: 20%
───────────────────────────────────────────────────────────────────────
  ❌ Critical docs: 4/7 present — MISSING: deploy-runbook, go-live, dr-plan
      → Run /ezra:doc create deploy-runbook
      → Run /ezra:doc create go-live
      → Run /ezra:doc create dr-plan
  ⚠️  Phase docs: 8/14 MUST HAVE present
  ⚠️  Stale docs: tad (42 days), roadmap (63 days)
      → Run /ezra:doc-sync
  ✅ Test directories: present in all source modules
  ❌ API docs: 12 routes undocumented
      → Run /ezra:doc create api-docs
  ⚠️  Decision gaps: Redis, OAuth2 lack ADRs
      → Run /ezra:decide Use Redis for session caching

PILLAR 3: CLEAN (92/100)                                       Weight: 15%
───────────────────────────────────────────────────────────────────────
  ✅ TypeScript strict: enabled
  ✅ No `any` types: 0 files
  ✅ Linter: ESLint + Prettier configured
  ✅ Consistent patterns: HIGH
  ⚠️  TODOs: 3 found — consider resolving
  ✅ No empty catch blocks
  ✅ No dead code detected

PILLAR 4: SECURE (68/100)                                      Weight: 25%
───────────────────────────────────────────────────────────────────────
  ✅ No hardcoded secrets
  ❌ npm audit: 2 critical, 5 high vulnerabilities
      → Run npm audit fix
  ✅ Auth middleware: present (OAuth2)
  ✅ Input validation: Zod schemas
  ⚠️  CORS: wildcard in development config (OK), check production
  ✅ .env not committed
  ❌ No rate limiting configured
      → Add rate limiter middleware
  ⚠️  Security architecture doc: STALE (45 days)
      → Run /ezra:doc-sync security-arch

PILLAR 5: BEST PRACTICES (81/100)                              Weight: 15%
───────────────────────────────────────────────────────────────────────
  ✅ CI/CD: GitHub Actions configured (3 workflows)
  ✅ Git branches: 4 active branches
  ✅ Error handling: custom error classes + middleware
  ⚠️  SOLID: 3 files > 300 lines — consider splitting
      → src/services/auth.service.ts (412 lines)
      → src/services/payment.service.ts (387 lines)
      → src/utils/helpers.ts (356 lines)
  ✅ Environment separation: dev/staging/prod configs
  ✅ Structured logging: Pino configured
  ✅ README: present (89 lines)
  ⚠️  No CLAUDE.md — project instructions not documented
      → Create .claude/CLAUDE.md

═══════════════════════════════════════════════════════════════════════

PRIORITY REMEDIATION (do these first — highest impact on score):

  1. 🔴 Fix 2 critical npm vulnerabilities (+12 to SECURE)
      → npm audit fix --force
  
  2. 🔴 Create deploy-runbook, go-live, dr-plan (+15 to NO GAPS)
      → /ezra:doc create deploy-runbook
  
  3. 🟠 Add rate limiting middleware (+5 to SECURE)
      → Install express-rate-limit or @nestjs/throttler
  
  4. 🟠 Run /ezra:doc-sync to refresh stale docs (+8 to NO GAPS)
  
  5. 🟡 Run /ezra:scan — last scan > 7 days (+5 to ON-TRACK)

  Projected score after remediation: ~<estimated>/100 (Grade <grade>)

═══════════════════════════════════════════════════════════════════════
```

## Persist Results

After running, save the health report to `.ezra/scans/<ISO>-health.yaml`:

```yaml
timestamp: <ISO>
type: health_check
version: <current EZRA version>
overall_score: <0-100>
grade: <A-F>

pillars:
  on_track:
    score: <0-100>
    checks: <detailed findings>
  no_gaps:
    score: <0-100>
    checks: <detailed findings>
  clean:
    score: <0-100>
    checks: <detailed findings>
  secure:
    score: <0-100>
    checks: <detailed findings>
  best_practices:
    score: <0-100>
    checks: <detailed findings>

remediation_priority:
  - action: <what to do>
    impact: <estimated score improvement>
    pillar: <which pillar>
```

Update `.ezra/versions/changelog.yaml` with a HEALTH_CHECK entry.
Update `.ezra/versions/current.yaml` with `last_health_check` and `health_score`.

## Rules

- Be precise. Every score must be traceable to specific checks.
- Be actionable. Every finding below 100 must have a concrete remediation step with the exact command to run.
- Be honest. Do not inflate scores. A 50/100 is a 50/100.
- Run the actual checks. Read actual files, run actual commands. Never estimate from memory.
- Show projected improvement. Calculate what the score would be after top remediations.

## Subcommand: gate-report

`/ezra:health gate-report <phase>` — Run and display the phase gate report for phase N.

1. Load gate result from `.ezra/gates/phase-<N>.yaml` if it exists (last run).
2. If no saved result, run `ezra-phase-gate.js runGate(cwd, N)` via `require()`.
3. Display:

```
EZRA PHASE GATE — Phase <N>                    <PASSED ✅ / FAILED ❌>
═══════════════════════════════════════════════════════════════
Overall Score: <score>/100  │  Run at: <timestamp>

  ✅ Tests         100/100  all tests passing
  ✅ Lint          100/100  no lint errors
  ✅ Security      100/100  0 critical/high findings
  ⏭️  Coverage     skipped  no minimum configured
  ✅ Standards     100/100  0 critical/high in last scan

BLOCKERS: none  ← or list failing checks
═══════════════════════════════════════════════════════════════
```

4. If gate failed, provide specific remediation steps for each blocker.
5. After displaying, save the result to `.ezra/gates/phase-<N>.yaml`.

## Suggested Next Steps

After a health check, suggest:
- Run `/ezra:advisor` for targeted recommendations on low-scoring pillars
- Run `/ezra:scan` for detailed analysis of specific findings
- Run `/ezra:doc-check` if the No Gaps pillar scored low
