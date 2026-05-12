---
tier: admin
name: ezra:oversight
description: View and configure real-time agent oversight. Shows violations, adjusts intervention level, and manages oversight statistics.
---

# EZRA Oversight — Real-Time Agent Monitoring

You are managing the EZRA real-time oversight system. This system monitors all Write/Edit operations and checks them against standards, security patterns, and governance rules.

## Subcommands

Parse the user input to determine which subcommand they want. If no subcommand is given, default to status.

### status (default)

Show current oversight configuration and status:

1. Read `.ezra/settings.yaml` (or use defaults if missing)
2. Display:
   - Oversight enabled: yes/no
   - Intervention level: monitor | warn | gate | strict
   - Health threshold: N
   - Auto-pause on critical: yes/no
   - Review every N files
   - Excluded paths: list
   - Notify on: severity levels
3. Check `.ezra/oversight/violations.log` for recent violations
4. Report violation count by severity (last 24h if timestamps available)

Output format:
```
EZRA OVERSIGHT STATUS
═══════════════════════════════════════════
Level: WARN | Enabled: yes
Health Threshold: 75 | Auto-pause: yes
Review Every: 5 files
Excluded: *.test.ts, *.spec.ts, docs/*
Notify On: critical, high
═══════════════════════════════════════════
Recent Violations (last 24h):
  CRITICAL: 0 | HIGH: 2 | MEDIUM: 5 | LOW: 3
═══════════════════════════════════════════
```

### level <monitor|warn|gate|strict>

Change the oversight intervention level:

1. Validate the level is one of: monitor, warn, gate, strict
2. Read `.ezra/settings.yaml`
3. Update the `oversight.level` value
4. Write back to `.ezra/settings.yaml`
5. Confirm the change

Levels:
- **monitor**: Logs all issues but never blocks. Use for observation.
- **warn**: Shows warnings inline but allows all operations. Default.
- **gate**: Blocks operations with critical or high severity violations.
- **strict**: Blocks ANY violation, regardless of severity.

### violations [severity]

Show violation history from `.ezra/oversight/violations.log`:

1. Read the violations log
2. If severity filter provided, show only matching entries
3. Group by file and show:
   - Timestamp
   - Severity
   - Code (STD-ANY, SEC-SECRETS, GOV-PROTECTED, etc.)
   - Message
4. Show summary counts

If no violations log exists, report "No violations recorded."

### clear

Clear the violations log:

1. Check if `.ezra/oversight/violations.log` exists
2. If yes, truncate it (write empty string)
3. Confirm: "Violations log cleared."

### stats

Show oversight statistics:

1. Read violations log
2. Calculate:
   - Total violations all-time
   - Violations by code (STD-ANY, SEC-SECRETS, etc.)
   - Violations by severity
   - Most frequently flagged files (top 5)
   - Violations trend (last 7 days if data available)
3. Display as formatted table

Output format:
```
EZRA OVERSIGHT STATISTICS
═══════════════════════════════════════════
Total Violations: 47

By Severity:
  CRITICAL: 3 | HIGH: 12 | MEDIUM: 20 | LOW: 12

By Code:
  STD-ANY: 15 | SEC-LOG: 10 | STD-COMPLEXITY: 8
  GOV-PROTECTED: 7 | SEC-SECRETS: 4 | SEC-SQLI: 3

Top Files:
  1. src/services/auth.ts (8 violations)
  2. src/routes/api.ts (6 violations)
  3. src/utils/db.ts (5 violations)
═══════════════════════════════════════════
```

## Notes

- All settings are stored in `.ezra/settings.yaml`
- Violations are logged to `.ezra/oversight/violations.log`
- The oversight hook (`ezra-oversight.js`) runs on every Write/Edit via PreToolUse
- Changes to oversight level take effect immediately for the next operation

## Suggested Next Steps

After reviewing oversight, suggest:
- Run `/ezra:settings` to adjust intervention levels and thresholds
- Run `/ezra:compliance check` to verify compliance against active profiles
- Run `/ezra:scan` to address flagged violations
