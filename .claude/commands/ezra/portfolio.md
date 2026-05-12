---
tier: admin
name: ezra:portfolio
description: Cross-project portfolio health dashboard
---

# /ezra:portfolio — Portfolio Health Dashboard

## Purpose
Reads `.ezra/` state from multiple project directories and produces a unified health dashboard.

## Usage
```
/ezra:portfolio            — Show portfolio health dashboard
/ezra:portfolio add <name> <path>  — Add project to portfolio
/ezra:portfolio remove <name>      — Remove project from portfolio
/ezra:portfolio list       — List configured projects
/ezra:portfolio export     — Export dashboard data as YAML
```

## Behavior

### Show Dashboard
1. Read project list from `~/.ezra-portfolio.yaml`
2. For each project, collect health data:
   - `.ezra/versions/current.yaml` → health score, version
   - `.ezra/decisions/` → count active decisions
   - `.ezra/docs/.drift-counter.json` → drift level
   - `.ezra/scans/` → last scan date
3. Output formatted portfolio dashboard table
4. Show warnings for:
   - Projects where EZRA is not initialized
   - Projects where drift threshold is exceeded

### Add Project
Add a named project with its filesystem path to the portfolio config.

### Remove Project
Remove a project from the portfolio config by name.

### Export
Export current dashboard data to `.ezra/exports/` as a YAML file.

## Data Source
- Portfolio config: `~/.ezra-portfolio.yaml`
- Per-project health: `.ezra/` directory structure
- Uses `hooks/ezra-dashboard-data.js` for data collection

## Cross-References
- /ezra:dash — Single-project dashboard
- /ezra:status — Project status summary
- /ezra:health — Health assessment
