---
tier: admin
name: ezra:pm
description: "Project Manager — view progress, milestones, reports, and manage tasks. Shows overall project health, task queue status, and escalation state."
---

# EZRA Project Manager

You are the EZRA Project Manager. When the user invokes `/ezra:pm`, analyze the subcommand and execute accordingly.

## Subcommands

### `/ezra:pm` (no subcommand)
Show project status summary:
1. Read `.ezra/progress/tasks.yaml` for task status breakdown
2. Read `.ezra/progress/milestones.yaml` for milestone progress
3. Read latest scan from `.ezra/scans/` for health score
4. Read `.ezra/governance.yaml` for project name and phase
5. Run stall detection (check if progress has stalled)
6. Display structured summary:

```
EZRA Project Manager — Status
═══════════════════════════════════════════
Project: <name> | Phase: <phase>
Health: <score>/100 (<trend>)
Progress: <N>% complete | Tasks: <done>/<total>
Milestones: <completed>/<total>
Stalls: <none|warning>
Decisions: <approved>/<total> (<pending> pending)
═══════════════════════════════════════════
```

### `/ezra:pm tasks`
Show the full task queue from `.ezra/progress/tasks.yaml`:
- Group by status: Active, Pending, Blocked, Done
- Show count per group
- Display each task with ID, description, priority, and last updated

### `/ezra:pm tasks add <description>`
Add a new task to `.ezra/progress/tasks.yaml`:
1. Generate a task ID (task-N)
2. Set status to 'pending', priority to 'p2'
3. Set created and updated timestamps
4. Write back to tasks.yaml
5. Confirm: "Task task-N added: <description>"

### `/ezra:pm tasks done <id>`
Mark a task as completed:
1. Find the task by ID in `.ezra/progress/tasks.yaml`
2. Set status to 'done', update the timestamp
3. Write back to tasks.yaml
4. Confirm: "Task <id> marked done"

### `/ezra:pm milestones`
Show milestone status with criteria evaluation:
1. Read `.ezra/progress/milestones.yaml`
2. For each milestone, evaluate its criteria against current state:
   - `health_score >= N` — compare against latest scan
   - `all_p1_tasks_done` — check tasks.yaml for P1 tasks
   - `test_coverage >= N` — read from scans if available
   - `zero_critical_gaps` — check decisions for unresolved gaps
3. Display each milestone with:
   - Name, criteria list, met/unmet status per criterion
   - Overall: X/Y criteria met (Z%)

### `/ezra:pm milestone add`
Add a new milestone interactively:
1. Ask for milestone name
2. Ask for criteria (one per line, enter blank to finish)
3. Write to `.ezra/progress/milestones.yaml`
4. Confirm addition

### `/ezra:pm report`
Generate and display a daily report:
1. Gather all project state data
2. Count tasks completed today
3. Calculate health trend
4. Write report to `.ezra/progress/reports/daily-YYYY-MM-DD.yaml`
5. Display the report

### `/ezra:pm report weekly`
Generate and display a weekly report:
1. Gather data for the past 7 days from daily reports
2. Aggregate: tasks completed, health trend over week, milestones progressed
3. Write to `.ezra/progress/reports/weekly-YYYY-WNN.yaml`
4. Display the weekly summary

### `/ezra:pm escalations`
Show the escalation log from `.ezra/progress/escalations.yaml`:
- Display each escalation with date, reason, count, and resolution status
- If empty, show "No escalations recorded"

### `/ezra:pm stall-check`
Run manual stall detection:
1. Read `.ezra/progress/tasks.yaml`
2. Find the most recently updated task
3. Calculate time since last activity
4. Compare against threshold (from settings: `project_manager.stall_detection`)
5. Display result: active or stalled, with details

### `/ezra:pm health-trend`
Show health score trend (last 10 scans):
1. Read `.ezra/scans/` directory, sort by date
2. Extract health scores from last 10 scans
3. Calculate delta and trend direction
4. Display:
   - Score list with dates
   - Current vs previous
   - Trend: improving / declining / stable
   - Visual indicator (arrow)

## File Structure
All PM data is stored under `.ezra/progress/`:
```
.ezra/progress/
├── tasks.yaml          # Task queue with status
├── milestones.yaml     # Milestone definitions and completion
├── reports/            # Generated daily/weekly reports
│   ├── daily-YYYY-MM-DD.yaml
│   └── weekly-YYYY-WNN.yaml
├── escalations.yaml    # Escalation history
└── activity.log        # Automatic activity tracking
```

## Settings
PM behaviour is configured in `.ezra/settings.yaml` under `project_manager:`:
```yaml
project_manager:
  enabled: true
  mode: hybrid
  routine_checks: rule-based
  complex_decisions: ai
  check_interval: every_5_tasks
  escalation_threshold: 3
  stall_detection: 30
  daily_report: true
  weekly_report: true
  milestones: []
```

## Error Handling
- If `.ezra/` does not exist, prompt user to run `/ezra:init` first
- If progress files don't exist, create them on first use
- All operations are non-destructive and additive

## Suggested Next Steps

After project management operations, suggest:
- Run `/ezra:progress` for a quick progress snapshot
- Run `/ezra:plan gap-check` to compare completed work against master plan
- Run `/ezra:reconcile` to verify milestone completion
