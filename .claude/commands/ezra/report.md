---
tier: admin
name: ezra:report
description: "/ezra:report — Generate Governance Health Report"
---

# /ezra:report — Generate Governance Health Report

Generate a comprehensive governance health report using agentic-reports.
Summarizes: decisions, violations, drift score, scan history, and recommendations.

## Usage
```
/ezra:report
/ezra:report --format markdown
/ezra:report --output .ezra/reports/
```

## Implementation

When this command is invoked:

1. **Collect governance metrics** from `.ezra/` directory:
   - Count decisions in `.ezra/decisions/`
   - Count violations in `.ezra/violations/` (if exists)
   - Read drift counter from `.ezra/state/drift.json`
   - Read last scan results from `.ezra/scans/`

2. **Call agentic-reports** API to generate the report:
   ```
   POST http://localhost:8000/generate-report
   {
     "query": "Generate a codebase governance health report. Metrics: [collected metrics]. Analyze compliance trends, identify risk areas, and provide actionable recommendations.",
     "report_type": "research_report",
     "max_results": 3
   }
   ```

3. **Save report** to `.ezra/reports/governance-report-{timestamp}.md`

4. **Display summary** to user with key findings.

## Prerequisites
- agentic-reports running: `pip install agentic-reports && uvicorn app.main:app`
- EXA_API_KEY and OPENAI_API_KEY environment variables set

## Integration
This command can be triggered:
- Manually via `/ezra:report`
- As part of `/ezra:health` (optional report generation)
- On a schedule via cron or watchdog integration
