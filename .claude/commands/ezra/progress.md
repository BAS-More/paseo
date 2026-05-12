---
tier: admin
name: ezra:progress
description: "Quick progress dashboard — completion %, active tasks, health trend, next milestone."
---

# EZRA Progress Dashboard

When the user invokes `/ezra:progress`, display a compact progress dashboard.

## Behaviour

1. Read `.ezra/governance.yaml` for project name and phase
2. Read `.ezra/progress/tasks.yaml` for task completion stats
3. Read `.ezra/scans/` for latest health score and trend
4. Read `.ezra/progress/milestones.yaml` for next pending milestone
5. Run stall detection

## Output Format

Display the following compact dashboard:

```
EZRA Progress Dashboard
═══════════════════════════════════════════
Project: <name> | Phase: <phase>
Overall: <N>% complete | Tasks: <done>/<total>
Health: <score>/100 (<trend>) | Last scan: <date>
Next Milestone: <name> (<M>/<N> criteria met)
Stalls: <none|warning>
═══════════════════════════════════════════
```

## Field Calculations

- **Overall %**: `(tasks done / tasks total) * 100`, rounded
- **Health score**: From latest `.ezra/scans/*.yaml` `health_score` field
- **Trend**: Compare last two scans — improving (+N), declining (-N), or stable
- **Next Milestone**: First milestone from `milestones.yaml` where `overall != true`
- **Stalls**: If no task updated in the last N minutes (from `project_manager.stall_detection` setting), show warning

## Edge Cases

- If `.ezra/` doesn't exist → "Run /ezra:init to initialize EZRA"
- If no tasks → "No tasks tracked yet. Use /ezra:pm tasks add to start."
- If no scans → Health: "N/A (no scans)"
- If no milestones → Next Milestone: "None defined"
- If stall detected → Show in amber/warning style

## Quick Tips
Display after the dashboard:
```
Quick actions:
  /ezra:pm tasks add <desc>   Add a task
  /ezra:pm tasks done <id>    Complete a task
  /ezra:pm report             Generate daily report
  /ezra:scan                  Run health scan
```
