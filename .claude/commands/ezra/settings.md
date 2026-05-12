---
tier: advanced
name: ezra:settings
description: Interactive settings manager with toggles, dropdowns, and guided choices. No file editing required.
---

# EZRA Settings — Interactive Configuration

You are the EZRA settings UI. NEVER ask the user to edit files. ALWAYS present choices as numbered options, toggles (ON/OFF), or dropdowns. Write all changes to `.ezra/settings.yaml` automatically.

## How to Present Settings

CRITICAL RULES for every interaction:
1. **Booleans** → show as toggle: `[ON]` or `[OFF]` — user says "on" or "off" to change
2. **Enums/choices** → show as numbered dropdown — user picks a number
3. **Numbers** → show current value with valid range — user types a number
4. **Arrays** → show as checklist with [x] or [ ] — user toggles by number
5. **Paths** → show as list with add/remove options
6. **NEVER** show raw YAML or ask users to type `section.key value`
7. **ALWAYS** confirm changes with a summary before writing

## Entry Point

If no arguments given, show the **main menu**:

```
EZRA SETTINGS
═══════════════════════════════════════════════════════════════

Pick a category to configure:

  1. Oversight       — How strict EZRA is when you code
  2. Security        — Secrets scanning, auth, rate limiting
  3. Standards       — Code quality rules and conventions
  4. Best Practices  — Proactive suggestions and domains
  5. Memory          — Auto-capture and pattern learning
  6. Self-Learning   — Weekly analysis and auto-improvement
  7. Agents          — Budget limits and provider settings
  8. Project Manager — Reports, stall detection, milestones
  9. Dashboard       — Export format and auto-export
  10. Workflows      — Templates and auto-run
  11. Planning       — Gap checks and checkpoints
  12. Cloud Sync     — Backup and sync settings
  13. Licensing      — Tier and license key
  14. Protected Paths — Files that require ADR approval to edit
  15. Hooks          — Enable/disable individual hooks

  D. Show all differences from defaults
  R. Reset a section to defaults
  E. Export settings

Pick a number (or type a category name):
═══════════════════════════════════════════════════════════════
```

Wait for the user to pick. Then show that category's interactive panel.

## Category Panels

### 1. Oversight

```
OVERSIGHT SETTINGS
═══════════════════════════════════════════════════════════════

  Oversight enabled       [ON]          ← toggle on/off

  Intervention level:                   ← pick one
    ( ) monitor  — logs silently, never interrupts
    ( ) warn     — shows warnings, doesn't block
    (x) gate     — blocks critical/high, allows rest     [CURRENT]
    ( ) strict   — blocks ANY violation

  Health threshold         [75]         ← enter 0-100
  Auto-pause on critical   [ON]         ← toggle
  Review every N files     [5]          ← enter number

  Notifications:                        ← check all that apply
    [x] critical
    [x] high
    [x] medium
    [x] low

  Excluded paths:                       ← manage list
    1. node_modules
    2. .git
    3. dist
    4. coverage
    [A] Add path  [R] Remove path

Pick a setting to change (number/letter), or B to go back:
═══════════════════════════════════════════════════════════════
```

### 2. Security

```
SECURITY SETTINGS
═══════════════════════════════════════════════════════════════

  Security profile:                     ← pick one
    ( ) minimal   — basic checks only
    (x) standard  — balanced security                    [CURRENT]
    ( ) strict    — thorough scanning
    ( ) paranoid  — maximum security

  Secrets scanning         [ON]         ← toggle
  Input validation         [ON]         ← toggle
  Rate limiting            [OFF]        ← toggle
  Require auth all routes  [OFF]        ← toggle
  Require HTTPS            [ON]         ← toggle
  Block on critical        [ON]         ← toggle
  Scan on commit           [ON]         ← toggle

  Allowed licenses:                     ← manage list
    [x] MIT  [x] Apache-2.0  [x] BSD-2-Clause
    [x] BSD-3-Clause  [x] ISC
    [A] Add license  [R] Remove license

  Custom security rules:                ← manage list
    (none configured)
    [A] Add rule  [R] Remove rule

Pick a setting to change, or B to go back:
═══════════════════════════════════════════════════════════════
```

### 3. Standards

```
STANDARDS SETTINGS
═══════════════════════════════════════════════════════════════

  TypeScript strict mode   [ON]         ← toggle
  No `any` types           [ON]         ← toggle
  Require tests            [ON]         ← toggle
  Require JSDoc            [OFF]        ← toggle

  Naming convention:                    ← pick one
    (x) camelCase                                        [CURRENT]
    ( ) PascalCase
    ( ) snake_case
    ( ) kebab-case

  Error handling:                       ← pick one
    (x) explicit  — require explicit error handling      [CURRENT]
    ( ) implicit  — allow implicit error handling

  Max complexity            [10]        ← enter number
  Test coverage minimum     [80]%       ← enter 0-100

  Allowed patterns:                     ← manage list
    [x] module  [x] factory  [x] singleton
    [A] Add pattern  [R] Remove pattern

  Forbidden patterns:                   ← manage list
    [x] god-object  [x] circular-dependency
    [A] Add pattern  [R] Remove pattern

  Custom rules:                         ← manage list
    (none configured)
    [A] Add rule  [R] Remove rule

Pick a setting to change, or B to go back:
═══════════════════════════════════════════════════════════════
```

### 4. Best Practices

```
BEST PRACTICES SETTINGS
═══════════════════════════════════════════════════════════════

  Best practices enabled   [ON]         ← toggle
  Auto-suggest             [ON]         ← toggle
  Auto-fix                 [OFF]        ← toggle

  Suggestion frequency:                 ← pick one
    (x) always    — suggest on every interaction         [CURRENT]
    ( ) on-review — only during code reviews
    ( ) manual    — only when asked

  Severity:                             ← pick one
    ( ) error
    (x) warn                                             [CURRENT]
    ( ) info

  Active domains:                       ← check all that apply
    [x] architecture
    [x] security
    [x] quality
    [x] testing
    [ ] documentation
    [ ] performance
    [ ] accessibility

Pick a setting to change, or B to go back:
═══════════════════════════════════════════════════════════════
```

### 5. Memory

```
MEMORY SETTINGS
═══════════════════════════════════════════════════════════════

  Auto-capture             [ON]         ← toggle
  Max entries              [500]        ← enter number
  Dedup threshold          [0.8]        ← enter 0.0-1.0
  Archive after days       [90]         ← enter number

  Capture sources:                      ← pick one
    (x) all       — capture from all tool outputs        [CURRENT]
    ( ) code-only — only from code changes
    ( ) manual    — only explicit /ezra:memory saves

Pick a setting to change, or B to go back:
═══════════════════════════════════════════════════════════════
```

### 6. Self-Learning

```
SELF-LEARNING SETTINGS
═══════════════════════════════════════════════════════════════

  Self-learning enabled    [ON]         ← toggle
  Auto-suggest             [ON]         ← toggle
  Auto-apply               [OFF]        ← toggle
  Report on scan           [ON]         ← toggle
  Report on dashboard      [ON]         ← toggle

  Analysis frequency:                   ← pick one
    ( ) daily
    (x) weekly                                           [CURRENT]
    ( ) monthly
    ( ) manual

  Confidence threshold     [0.75]       ← enter 0.0-1.0
  Min data points          [10]         ← enter number

  Learning domains:                     ← check all that apply
    [x] standards effectiveness
    [x] agent profiles
    [x] violation patterns
    [x] health trajectories
    [x] decision impact
    [x] workflow optimisation
    [x] cost optimisation

  Cross-project learning   [OFF]        ← toggle

Pick a setting to change, or B to go back:
═══════════════════════════════════════════════════════════════
```

### 7. Agents

```
AGENT SETTINGS
═══════════════════════════════════════════════════════════════

  Agents enabled           [ON]         ← toggle
  Max concurrent           [3]          ← enter 1-10

  Default provider:                     ← pick one
    (x) anthropic                                        [CURRENT]
    ( ) openai
    ( ) ollama (local)

  Budget:
    Daily limit            [$10.00]     ← enter amount
    Monthly limit          [$200.00]    ← enter amount
    Currency               [USD]        ← pick: USD, EUR, GBP, AUD

  Assignment strategy:                  ← pick one
    (x) auto      — EZRA picks best agent               [CURRENT]
    ( ) manual    — you choose agents
    ( ) round-robin

  Fallback order:                       ← reorder list
    1. claude
    2. codex
    3. cursor
    [A] Add  [R] Remove  [U] Move up  [D] Move down

Pick a setting to change, or B to go back:
═══════════════════════════════════════════════════════════════
```

### 8. Project Manager

```
PROJECT MANAGER SETTINGS
═══════════════════════════════════════════════════════════════

  Project manager enabled  [ON]         ← toggle
  Daily report             [ON]         ← toggle
  Weekly report            [ON]         ← toggle

  Mode:                                 ← pick one
    ( ) rule-based — all decisions by rules
    (x) hybrid     — rules for routine, AI for complex   [CURRENT]
    ( ) ai         — AI makes all decisions

  Check interval:                       ← pick one
    ( ) every task
    (x) every 5 tasks                                    [CURRENT]
    ( ) every 10 tasks
    ( ) manual

  Escalation threshold     [3]          ← enter number
  Stall detection (mins)   [30]         ← enter number

Pick a setting to change, or B to go back:
═══════════════════════════════════════════════════════════════
```

### 9. Dashboard

```
DASHBOARD SETTINGS
═══════════════════════════════════════════════════════════════

  Auto-export              [ON]         ← toggle

  Export format:                        ← pick one
    (x) json                                             [CURRENT]
    ( ) yaml

  Export interval:                      ← pick one
    (x) every scan                                       [CURRENT]
    ( ) daily
    ( ) manual

  Portfolio path           [~/.ezra-portfolio.yaml]  ← enter path

Pick a setting to change, or B to go back:
═══════════════════════════════════════════════════════════════
```

### 10. Workflows

```
WORKFLOW SETTINGS
═══════════════════════════════════════════════════════════════

  Auto-run                 [OFF]        ← toggle
  Approval gates           [ON]         ← toggle

  Active templates:                     ← check all that apply
    [x] all
    Or pick specific:
    [ ] anti-drift-enforcement
    [ ] security-audit
    [ ] post-deployment-testing
    [ ] deep-gap-analysis

  Auto-run triggers:
    On commit              [ ] anti-drift-enforcement
    On PR                  [ ] security-audit
    On deploy              [ ] post-deployment-testing
    Weekly                 [ ] deep-gap-analysis

Pick a setting to change, or B to go back:
═══════════════════════════════════════════════════════════════
```

### 11. Planning

```
PLANNING SETTINGS
═══════════════════════════════════════════════════════════════

  Planning enabled         [ON]         ← toggle
  Auto-assign tasks        [ON]         ← toggle
  Checkpoint on milestone  [ON]         ← toggle
  Gap check after N tasks  [5]          ← enter number

Pick a setting to change, or B to go back:
═══════════════════════════════════════════════════════════════
```

### 12. Cloud Sync

```
CLOUD SYNC SETTINGS
═══════════════════════════════════════════════════════════════

  Cloud sync enabled       [OFF]        ← toggle
  Auto-backup              [OFF]        ← toggle
  Sync on change           [OFF]        ← toggle
  Backup retention         [5]          ← enter number

  Provider:                             ← pick one
    (x) local     — no remote sync                       [CURRENT]
    ( ) s3        — Amazon S3
    ( ) azure     — Azure Blob Storage
    ( ) gcs       — Google Cloud Storage
    ( ) custom    — custom endpoint

  Endpoint                 [not set]    ← enter URL
  Sync interval (seconds)  [300]        ← enter number

Pick a setting to change, or B to go back:
═══════════════════════════════════════════════════════════════
```

### 13. Licensing

```
LICENSING SETTINGS
═══════════════════════════════════════════════════════════════

  Current tier:                         ← pick one
    (x) core       — free, basic governance              [CURRENT]
    ( ) pro        — advanced features
    ( ) enterprise — full suite + support

  License key              [not set]    ← enter key
  Offline cache days       [30]         ← enter number

Pick a setting to change, or B to go back:
═══════════════════════════════════════════════════════════════
```

### 14. Protected Paths

Read `.ezra/governance.yaml` protected_paths section.

```
PROTECTED PATHS
═══════════════════════════════════════════════════════════════

Protected paths require an ADR before EZRA allows edits.

  #  Pattern              Reason
  1. bin/cli.js           CLI installer — changes affect all users
  2. hooks/*.js           Hook protocol — must always exit 0
  3. agents/*.md          Agent definitions — changes affect behavior
  4. skills/ezra/SKILL.md Skill definition — affects auto-triggering
  5. commands/ezra/*.md   Slash commands — user-facing changes
  6. templates/*.yaml     Process templates — affects workflow execution
  7. package.json         Package manifest — zero dependencies rule

  [A] Add a protected path
  [R] Remove a protected path (by number)
  [E] Edit a path's reason

Pick an action, or B to go back:
═══════════════════════════════════════════════════════════════
```

When adding: ask for the glob pattern, then ask for the reason.
When removing: confirm before removing.
Write changes to `.ezra/governance.yaml`.

### 15. Hooks

Read `~/.claude/settings.json` hooks section.

```
HOOKS CONFIGURATION
═══════════════════════════════════════════════════════════════

  Event: SessionStart
  1. [ON]  ezra-dash-hook.js       Dashboard on session open

  Event: PreToolUse (Edit|Write|MultiEdit)
  2. [ON]  ezra-guard.js           Protected path enforcement
  3. [ON]  ezra-oversight.js       Code standards & security gate

  Event: PostToolUse (Write|Edit|MultiEdit)
  4. [ON]  ezra-drift-hook.js      Doc staleness counter
  5. [ON]  ezra-version-hook.js    State versioning
  6. [ON]  ezra-progress-hook.js   Milestone tracking
  7. [ON]  ezra-memory-hook.js     Auto-capture patterns

  Event: Notification
  8. [ON]  ezra-notifier.js        Desktop toast alerts

  Toggle a hook by number, or:
  [A] Add a hook  [D] Disable all  [E] Enable all

Pick a number or action, or B to go back:
═══════════════════════════════════════════════════════════════
```

Toggling a hook: remove/add it from `~/.claude/settings.json` hooks array.

## Applying Changes

After EVERY change:
1. Show what changed: `Changed: oversight.level gate → strict`
2. Write to `.ezra/settings.yaml` (or `governance.yaml` for protected paths, or `~/.claude/settings.json` for hooks)
3. Show: `Saved to .ezra/settings.yaml`
4. Return to the category panel (not the main menu)

## Validation Rules

Before writing any value, validate:
- **Booleans**: must be true/false
- **Numbers**: must be within range (0-100 for percentages, > 0 for counts)
- **Enums**: must be one of the listed options
- **Arrays**: items must be non-empty strings
- **Paths**: must be valid glob patterns (no empty strings)
- **URLs**: must start with http:// or https:// (for endpoints)
- **Budget**: must be >= 0

If invalid, show: `Invalid value. Expected: <type/range>. Try again:`

## Scope

When the user runs `/ezra:settings`, ask first if not clear:

```
Configure settings for:
  1. This project (.ezra/settings.yaml)
  2. Global defaults (~/.claude/hooks/ezra-defaults.yaml)
```

Default to project settings. Global defaults affect all EZRA-governed projects.

## Quick Access

Support direct access: `/ezra:settings oversight` jumps straight to the Oversight panel.
Support direct set: `/ezra:settings oversight level` shows just the level picker.
