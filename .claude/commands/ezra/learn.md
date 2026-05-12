---
tier: admin
name: ezra:learn
description: "View and manage EZRA's self-learning system. Shows learning insights, pending recommendations, agent performance profiles, violation patterns, and cost optimisation suggestions. Use /ezra:learn to see summary, /ezra:learn review to act on recommendations."
---

# /ezra:learn — Self-Learning Intelligence

## Purpose

View and manage EZRA's continuous learning system. EZRA collects data from every oversight check, agent task, health scan, and workflow execution, then analyses patterns to generate actionable recommendations.

## Usage

### Summary

```
/ezra:learn
```

Shows:
- Total data points collected
- Last analysis date
- Pending recommendations count
- Learning health by domain (active/inactive, data point count)

### Review Recommendations

```
/ezra:learn review
```

Presents each pending recommendation with:
- Confidence score (0-1)
- Observation (what EZRA noticed)
- Recommendation (what EZRA suggests)
- Impact estimate
- Options: Accept / Reject / Modify

### Agent Performance Profiles

```
/ezra:learn agents
```

Shows per-agent metrics:
- Task count, acceptance rate, revision rate
- Average violation rate per task
- Speed (avg completion time)
- Cost efficiency (cost per accepted output)
- Best task types for this agent
- Recommended routing changes

### Violation Pattern Analysis

```
/ezra:learn violations
```

Shows:
- Most common violation types (top 10)
- Files with highest violation density
- Time-based patterns (if detectable)
- Predictive warnings for known problem areas

### Health Trajectory

```
/ezra:learn health
```

Shows:
- Health score trend (last 10 scans)
- Actions that correlated with score improvements
- Actions that correlated with score declines
- Recommended next actions for maximum health improvement

### Workflow Optimisation

```
/ezra:learn workflows
```

Shows:
- Per-template execution stats (avg time, failure rate, skip rate)
- Step-level bottleneck identification
- Parallelisation opportunities
- Suggested step reordering

### Cost Analysis

```
/ezra:learn costs
```

Shows:
- Total spend by agent (daily/weekly/monthly)
- Quality-adjusted cost (cost per accepted output)
- Budget utilisation vs ceiling
- Cost optimisation recommendations

### Reset Learning Data

```
/ezra:learn reset <domain>
/ezra:learn reset all
```

Clears collected learning data for a specific domain or all domains. Requires confirmation. Does NOT delete recommendations already accepted.

### Export

```
/ezra:learn export
```

Exports all learning data as structured YAML for backup or cross-project sharing.

## Behaviour

1. Read `.ezra/settings.yaml` → `self_learning` section for configuration
2. Read `.ezra/learning/` directory for collected data and recommendations
3. For `review` subcommand: present each pending recommendation interactively
4. Accepted recommendations update settings.yaml or governance.yaml as appropriate
5. All actions logged to `.ezra/versions/changelog.yaml`

## Data Sources

| Source | Feeds Into |
|--------|-----------|
| `.ezra/oversight/violations.log` | violation_patterns, standards_effectiveness |
| `/ezra:health` scan results | health_trajectories |
| `/ezra:review` findings | standards_effectiveness, agent_profiles |
| `/ezra:auto` execution logs | workflow_optimisation |
| Agent task completions | agent_profiles, cost_optimisation |
| `/ezra:decide` records | decision_impact |
| `/ezra:settings` changes | standards_effectiveness |

## Settings

```yaml
self_learning:
  enabled: true
  analysis_frequency: weekly
  min_data_points: 10
  confidence_threshold: 0.75
  auto_apply: false
  report_on_scan: true
  report_on_dash: true
  domains:
    standards_effectiveness: true
    agent_profiles: true
    violation_patterns: true
    health_trajectories: true
    decision_impact: true
    workflow_optimisation: true
    cost_optimisation: true
  cross_project:
    enabled: false
    shared_domains: []
```

## Related Commands

- `/ezra:oversight` — Real-time violation data (feeds self-learning)
- `/ezra:settings` — Configure self-learning parameters
- `/ezra:health` — Health scans (feeds health trajectories)
- `/ezra:dash` — Dashboard (shows learning insights widget when enabled)
