---
tier: admin
name: ezra:interview
description: Interactive gap interview — discover missing project definition details and generate .ezra/project-definition.yaml
---

# EZRA Interview Engine

You are running an **interactive gap interview** to build a complete project definition. Your goal is to produce `.ezra/project-definition.yaml` by discovering everything EZRA needs to generate an accurate plan.

## How to Run

1. **Check for existing ingested documents** — look in `.ezra/ingested/` for any previously ingested files
2. **Load existing definition** — if `.ezra/project-definition.yaml` exists, load it to find gaps only
3. **Run the gap interview** — use the interview engine to ask only what is still missing
4. **Save and confirm** — write the complete definition and show the user a summary

## Starting the Interview

```javascript
const engine = require('.claude/hooks/ezra-interview-engine.js');
const definition = require('.claude/hooks/ezra-project-definition.js');
const path = require('path');

const projectDir = process.cwd();

// Load any existing definition
let existing = {};
try { existing = definition.load(projectDir); } catch (_) {}

// Detect gaps
const gaps = engine.detectGaps(existing);

if (gaps.length === 0) {
  console.log('Project definition is complete. No interview needed.');
  console.log('Run /ezra:plan generate to create your plan.');
} else {
  console.log(`Starting interview — ${gaps.length} domain(s) need answers.`);
  engine.runInterviewCLI(projectDir, existing);
}
```

## Subcommands

### `/ezra:interview` (default — run full interview)
Runs the gap interview for the current project. Skips domains already answered.

### `/ezra:interview show`
Display the current project definition in a readable format.

### `/ezra:interview reset`
Clear the project definition and start fresh.

### `/ezra:interview status`
Show which domains are complete and which still need answers.

## Interview Domains

The interview covers 12 domains:

| Domain | What It Discovers |
|---|---|
| `project_name` | The project name |
| `description` | What the project does and its goals |
| `tech_stack` | Languages, frameworks, databases, cloud services |
| `features` | Core features and user stories |
| `auth_strategy` | Authentication and authorisation approach |
| `database_choice` | Database(s) and data storage decisions |
| `deployment_target` | Where and how the app will be deployed |
| `testing_requirements` | Testing strategy, tools, coverage targets |
| `security_level` | Security posture (low/standard/high/critical) |
| `performance_targets` | Response time, throughput, scalability goals |
| `team_size` | Team size and working conventions |
| `timeline` | Project timeline, milestones, phases |

## What Happens After

When all gaps are filled, EZRA will:
1. Write `.ezra/project-definition.yaml` with the full definition
2. Confirm which features, constraints, and tech signals were detected
3. Suggest running `/ezra:plan generate` to create the master plan

## Integration with Ingested Documents

If you have project documents (PRDs, architecture docs, previous plans), ingest them first:

```
/ezra:interview
```

EZRA will automatically detect any documents in `.ezra/ingested/` and pre-fill answers from them, then only ask about the remaining gaps.

To manually ingest a document before interviewing:
```
# The interview command will look for documents you describe inline
# or you can describe your project directly in chat and EZRA will extract signals
```

## Output Format

The interview produces `.ezra/project-definition.yaml`:

```yaml
project_name: MyApp
description: A SaaS platform for team collaboration
version: "1.0"
created_at: "2026-03-29"
updated_at: "2026-03-29"

tech_stack:
  languages: [TypeScript, Python]
  frameworks: [Next.js, FastAPI]
  databases: [PostgreSQL, Redis]
  cloud: [Vercel, Supabase]

features:
  - User authentication and profiles
  - Real-time messaging
  - File sharing with version history

auth_strategy: JWT with refresh tokens, OAuth (Google, GitHub)
database_choice: PostgreSQL via Supabase; Redis for session/cache
deployment_target: Vercel (frontend), Supabase (backend + DB)
testing_requirements: Vitest unit tests, Playwright E2E, 80% coverage
security_level: high
performance_targets: <200ms API response, 10k concurrent users
team_size: 4 developers, 1 PM, agile sprints
timeline: 3-month MVP, then monthly releases
```

This file drives `/ezra:plan generate` — the richer the definition, the better the generated plan.
