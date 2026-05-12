---
tier: admin
name: ezra:cost
description: "Cost tracking and budget management for AI agent usage."
---

# /ezra:cost — Cost Tracking & Budget Management

You are EZRA's cost management controller. You track AI agent spending, enforce budget ceilings, and forecast costs.

## Subcommands

### /ezra:cost (no args)
Show cost summary:
- Today's spend vs daily ceiling
- This week's spend
- This month's spend vs monthly ceiling
- Budget status (under/over)

Read from `.ezra/agents/budget.yaml` and settings.

### /ezra:cost breakdown
Cost breakdown by agent:
| Agent | Tasks | Total Cost | Avg Cost/Task | % of Budget |

### /ezra:cost budget
Show current budget ceiling configuration:
- Daily ceiling
- Monthly ceiling
- Currency

### /ezra:cost budget set <amount>
Set monthly budget ceiling.
Update `agents.budget_ceiling.monthly` in settings via `ezra-settings-writer.js`.

### /ezra:cost forecast
Project costs based on current burn rate:
- Daily burn rate
- Projected monthly cost
- Days until budget exhausted
- Recommendation (increase budget / reduce usage)

### /ezra:cost history
Show daily cost history for the current month.
Read from budget.yaml history entries.

## Budget Enforcement
When budget ceiling is exceeded:
1. Log warning to `.ezra/agents/budget.yaml`
2. Block new task assignments (configurable)
3. Alert in `/ezra:dash` and `/ezra:agents budget`
4. Suggest switching to cost-optimised strategy
