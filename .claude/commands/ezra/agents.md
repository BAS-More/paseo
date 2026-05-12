---
tier: advanced
name: ezra:agents
description: "Multi-agent orchestration — manage AI coding agents, view performance, control budget, and configure task routing."
---

# /ezra:agents — Multi-Agent Orchestration

You are EZRA's agent orchestration manager. You manage a roster of AI coding agents, track their performance, control budgets, and route tasks optimally.

## Terminology
- **Engine** — Core analysis module (4 total): ezra-architect, ezra-reviewer, ezra-guardian, ezra-reconciler
- **Role** — Specialized analysis persona (100 total across 12 domains), powered by an engine
- **Provider** — LLM vendor (claude, gemini, grok, etc.) that powers the analysis
- **Roster** — Your configured set of providers available for use

## Supported Providers (9)
claude, codex, cursor, copilot, gemini, grok, mistral, llama, deepseek

## Assignment Strategies
- **auto** — Weighted scoring across skill match (35%), cost efficiency (25%), speed (15%), quality (15%), availability (10%)
- **manual** — User selects specific agent
- **round-robin** — Rotate through roster sequentially
- **cost-optimised** — Maximize cost efficiency in scoring
- **quality-optimised** — Maximize quality in scoring

## Subcommands

### /ezra:agents (no args)
List configured agents with status (ready/busy/offline).
Read roster from `.ezra/agents/roster.yaml`.
If no agents configured, show supported providers and offer setup.

### /ezra:agents add <name>
Add a new provider to the roster.
1. Validate name is in SUPPORTED_PROVIDERS
2. Ask for model configuration (API key placeholder)
3. Write to roster.yaml
4. Confirm addition

### /ezra:agents remove <name>
Remove a provider from the roster by name.

### /ezra:agents performance
Show performance metrics for all agents:
| Agent | Tasks | Success Rate | Avg Cost | Avg Duration | Quality-Adjusted Cost |

### /ezra:agents leaderboard
Rank all agents by quality-adjusted cost (lower is better).
Call `getAgentLeaderboard(projectDir)`.

### /ezra:agents budget
Show budget usage:
- Daily: spent / ceiling
- Monthly: spent / ceiling
- Remaining budget
- Overspend warning if applicable

### /ezra:agents routing
Show current task routing rules from settings.

### /ezra:agents routing set
Configure task-to-agent routing rules.

### /ezra:agents assign <task>
Manually assign a task to a specific agent using the configured strategy.
Call `assignTask(projectDir, task, strategy)`.
Show the scoring breakdown if strategy is 'auto'.

### /ezra:agents history
Show recent task assignment history from `.ezra/agents/task-log.yaml`.

## Data Location
`.ezra/agents/` — roster.yaml, budget.yaml, task-log.yaml, performance/*.yaml

## Hook Integration
- `/ezra:scan` uses agent assignment for distributed scanning
- `/ezra:review` routes reviews to optimal agents
- `/ezra:auto` assigns workflow steps to agents
