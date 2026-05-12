---
tier: admin
name: ezra:process
description: "Adjustable development process engine. Create, run, edit, and save reusable step-by-step workflows. Usage: /ezra:process create <name>, /ezra:process run <name>, /ezra:process list, /ezra:process edit <name>, /ezra:process template save <name>, /ezra:process template list, /ezra:process template load <name>."
---

You are managing the EZRA Process Engine — the system for creating, running, and managing repeatable development workflows.

If `.ezra/` does not exist, tell the user to run `/ezra:init` first and stop.

## State Directory

```
.ezra/processes/
├── active/                 # Currently defined processes for this project
│   ├── <process-name>.yaml
│   └── ...
├── runs/                   # Execution history
│   ├── <process-name>-<ISO>.yaml
│   └── ...
└── templates/              # Saved reusable templates (portable across projects)
    ├── full-remediation.yaml
    ├── release-prep.yaml
    └── ...
```

## Argument Parsing

- `/ezra:process create <name>` → Interactive process builder
- `/ezra:process create <name> from <template>` → Create from template
- `/ezra:process run <name>` → Execute a process (interactive, step-by-step with approval)
- `/ezra:process run <name> --auto` → Execute autonomously with guard rails (see /ezra:auto)
- `/ezra:process list` → List all processes with status
- `/ezra:process edit <name>` → Modify an existing process
- `/ezra:process delete <name>` → Remove a process (with confirmation)
- `/ezra:process history <name>` → Show execution history
- `/ezra:process template save <name>` → Save a process as a reusable template
- `/ezra:process template list` → List available templates
- `/ezra:process template load <name>` → Load a template into current project
- `/ezra:process template export <name>` → Export template as standalone YAML file
- `/ezra:process` → Show help

## Process Definition Format

`.ezra/processes/active/<name>.yaml`:

```yaml
name: <process name>
description: <what this process does>
version: 1
created: <ISO>
updated: <ISO>
author: <who created it>

# When this process should be triggered
triggers:
  manual: true                    # Can be run manually via /ezra:process run
  on_phase_change: false          # Auto-trigger on phase change
  on_schedule: null               # Cron-like: "weekly", "before-release", etc.
  on_event: null                  # "pre-commit", "pre-merge", "post-deploy"

# Guard rails — conditions that MUST be true for the process to proceed
guard_rails:
  require_clean_git: true         # No uncommitted changes
  require_passing_tests: false    # Tests must pass before starting
  require_health_score_min: null  # Minimum health score (e.g., 50)
  require_no_critical_risks: false # No critical risks open
  require_docs_current: false     # No stale MUST HAVE docs
  block_on_failure: true          # Stop entire process if a step fails
  max_consecutive_failures: 2     # Stop after N consecutive failures
  custom_guards:                  # Custom guard conditions
    - name: <guard name>
      check: <command or condition to evaluate>
      fail_message: <what to show if guard fails>

# The steps — executed in order
steps:
  - id: 1
    name: <step name>
    description: <what this step does>
    type: command | ezra | script | check | approval | report
    
    # For type: command — run a shell command
    command: <bash command to execute>
    
    # For type: ezra — run an EZRA command
    ezra_command: <e.g., "scan", "health", "doc-sync", "guard">
    ezra_args: <arguments if any>
    
    # For type: script — run a script file
    script: <path to script>
    args: <arguments>
    
    # For type: check — evaluate a condition
    condition: <what to check>
    pass_criteria: <what constitutes a pass>
    
    # For type: approval — pause and ask user
    approval_message: <what to ask the user>
    
    # For type: report — generate and present a report
    report_type: <summary | detailed | diff>
    report_sources: <what data to include>
    
    # Step behaviour
    on_failure: stop | skip | retry | ask    # What to do if step fails
    retry_count: 0                            # How many retries if on_failure=retry
    timeout: null                             # Timeout in seconds (null = no limit)
    continue_on_skip: true                    # If skipped, continue to next step
    
    # Step dependencies
    depends_on: []                            # Step IDs that must complete first
    skip_if: null                             # Condition to skip this step
    
    # Output handling
    capture_output: true                      # Save output for reporting
    output_variable: null                     # Name variable for use in later steps
    
  - id: 2
    name: <next step>
    ...

# Post-process actions
on_complete:
  generate_report: true           # Auto-generate execution report
  log_to_changelog: true          # Log completion to EZRA changelog
  create_snapshot: false          # Auto-create version snapshot
  notify: null                    # Notification message

on_failure:
  generate_report: true
  log_to_changelog: true
  rollback_steps: []              # Step IDs to reverse on failure
```

## ACTION: create <name> — Interactive Process Builder

Walk the user through building a process:

1. Ask: "What does this process do?" → Set `description`
2. Ask: "How many steps?" or "Describe your steps and I'll structure them."
3. For each step, determine:
   - Name and description
   - Type (command, ezra, script, check, approval, report)
   - The actual action
   - Failure handling (stop, skip, retry, ask)
4. Ask about guard rails: "What conditions must be true before running?"
5. Ask about triggers: "Should this run manually, on schedule, or on events?"
6. Write the process file
7. Confirm: "✅ Process '<name>' created with <n> steps."

If the user provides a plain-text description like:
```
step 1) run gap analysis
step 2) bridge all findings
step 3) run bug test
step 4) execute report
```

Parse this automatically into structured steps:

```yaml
steps:
  - id: 1
    name: Gap Analysis
    type: ezra
    ezra_command: doc-check
    on_failure: stop
    
  - id: 2
    name: Bridge Findings
    description: Address all gaps identified in step 1
    type: ezra
    ezra_command: doc create
    ezra_args: <dynamically determined from step 1 output>
    on_failure: ask
    
  - id: 3
    name: Bug Test
    type: command
    command: npm test
    on_failure: stop
    
  - id: 4
    name: Generate Report
    type: report
    report_type: detailed
    report_sources: [steps.1, steps.2, steps.3]
    on_failure: skip
```

## ACTION: run <name> — Execute Process (Interactive)

1. Load the process definition
2. Check ALL guard rails first:
   ```
   EZRA PROCESS — <name>
   ═══════════════════════════════════════════
   Guard Rail Check:
     ✅ Clean git: yes
     ✅ Tests passing: yes
     ❌ Health score ≥ 50: FAIL (current: 38)
   
   Guard rail failed. Cannot proceed.
   Fix: Run /ezra:health and address critical items.
   ═══════════════════════════════════════════
   ```
3. If guards pass, execute steps sequentially:
   ```
   EZRA PROCESS — <name>
   ═══════════════════════════════════════════
   Step 1/4: Gap Analysis
   Running: /ezra:doc-check
   ...
   ✅ Step 1 complete. 3 gaps identified.
   
   Step 2/4: Bridge Findings
   Running: /ezra:doc create deploy-runbook
   ...
   ✅ Step 2 complete. 3 documents created.
   
   Step 3/4: Bug Test
   Running: npm test
   ...
   ❌ Step 3 FAILED. 2 tests failing.
   Action: [R]etry / [S]kip / [A]bort?
   ═══════════════════════════════════════════
   ```
4. After completion (or abort), generate execution report
5. Save run to `.ezra/processes/runs/<name>-<ISO>.yaml`

## ACTION: edit <name> — Modify Process

1. Load the existing process
2. Present current steps as a numbered list
3. Ask: "What do you want to change?"
   - "Add step after step 3"
   - "Remove step 5"
   - "Change step 2 to run /ezra:scan instead"
   - "Reorder steps 3 and 4"
   - "Change guard rail: require health ≥ 60"
4. Apply changes, bump process version
5. Confirm changes

## ACTION: template save <name> — Save as Template

1. Read the process definition
2. Strip project-specific details (paths, specific file names)
3. Generalize commands where possible
4. Save to `.ezra/processes/templates/<name>.yaml`
5. Add metadata: `template: true`, `portable: true`
6. Confirm: "✅ Template '<name>' saved. Can be loaded in any project."

## ACTION: template list — Show Templates

```
EZRA PROCESS TEMPLATES
═══════════════════════════════════════════════════
BUILT-IN:
  full-remediation    │ 8 steps │ Gap analysis → bridge → test → report
  release-prep        │ 6 steps │ Health check → security → docs → deploy prep
  sprint-close        │ 5 steps │ Tests → scan → doc-sync → reconcile → snapshot
  security-audit      │ 7 steps │ Full OWASP scan → dep audit → secrets check → report
  onboarding          │ 4 steps │ Init → scan → doc-check → advisor

CUSTOM:
  <user-saved templates>

Use: /ezra:process create <name> from <template>
═══════════════════════════════════════════════════
```

## BUILT-IN TEMPLATES

Create these as defaults during `/ezra:init`:

### full-remediation
```yaml
steps:
  - {id: 1, name: "Gap Analysis", type: ezra, ezra_command: doc-check}
  - {id: 2, name: "Health Assessment", type: ezra, ezra_command: health}
  - {id: 3, name: "Bridge Document Gaps", type: approval, approval_message: "Create missing critical documents?"}
  - {id: 4, name: "Create Missing Docs", type: ezra, ezra_command: doc create, depends_on: [3]}
  - {id: 5, name: "Run Tests", type: command, command: "npm test"}
  - {id: 6, name: "Security Scan", type: ezra, ezra_command: scan}
  - {id: 7, name: "Sync Stale Docs", type: ezra, ezra_command: doc-sync}
  - {id: 8, name: "Final Report", type: report, report_type: detailed}
```

### release-prep
```yaml
steps:
  - {id: 1, name: "Health Gate", type: ezra, ezra_command: health, on_failure: stop}
  - {id: 2, name: "Security Audit", type: ezra, ezra_command: scan}
  - {id: 3, name: "Doc Completeness", type: ezra, ezra_command: doc-check}
  - {id: 4, name: "Plan Reconciliation", type: ezra, ezra_command: reconcile}
  - {id: 5, name: "Version Snapshot", type: ezra, ezra_command: "version snapshot pre-release"}
  - {id: 6, name: "Release Report", type: report, report_type: detailed}
```

### sprint-close
```yaml
steps:
  - {id: 1, name: "Run Tests", type: command, command: "npm test"}
  - {id: 2, name: "Code Scan", type: ezra, ezra_command: scan}
  - {id: 3, name: "Doc Sync", type: ezra, ezra_command: doc-sync}
  - {id: 4, name: "Plan Reconcile", type: ezra, ezra_command: reconcile}
  - {id: 5, name: "Sprint Snapshot", type: ezra, ezra_command: "version snapshot sprint-end"}
```

## ACTION: list — Show All Processes

```
EZRA PROCESSES
═══════════════════════════════════════════════════
Active Processes:
  full-remediation  │ 8 steps │ Last run: 2026-03-18 │ ✅ PASSED
  release-prep      │ 6 steps │ Last run: never      │ —
  my-custom-flow    │ 5 steps │ Last run: 2026-03-19 │ ❌ FAILED (step 3)

Templates: 5 built-in + 2 custom
Runs this week: 4 (3 passed, 1 failed)
═══════════════════════════════════════════════════
```

## Execution Report Format

Saved to `.ezra/processes/runs/`:

```yaml
process: <name>
version: <process version>
started: <ISO>
completed: <ISO>
duration: <seconds>
status: PASSED | FAILED | ABORTED | PARTIAL
triggered_by: manual | auto | schedule | event

guard_rails:
  all_passed: <true/false>
  details: [{name: ..., status: PASS|FAIL}]

steps:
  - id: 1
    name: <name>
    status: PASSED | FAILED | SKIPPED | ABORTED
    started: <ISO>
    completed: <ISO>
    duration: <seconds>
    output_summary: <1-2 lines of key output>
    error: <if failed, error details>

summary:
  steps_total: <n>
  steps_passed: <n>
  steps_failed: <n>
  steps_skipped: <n>
  key_findings: [<top findings across all steps>]
  recommended_next: [<what to do after this process>]
```

## Rules

- Process definitions are YAML — human-readable, version-controlled, shareable.
- Built-in templates are created on `/ezra:init` but can be customized.
- Every run is persisted. History is never lost.
- Guard rails are checked BEFORE the first step. If guards fail, the process doesn't start.
- In interactive mode, failed steps always ask the user what to do.
- In `--auto` mode, failed steps follow the `on_failure` setting (see /ezra:auto).
- Processes can reference output from previous steps via `output_variable`.
