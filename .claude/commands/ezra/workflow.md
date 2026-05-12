---
tier: advanced
name: ezra:workflow
description: "Enhanced workflow template system with validation, composition, dependencies, and execution tracking."
---

# /ezra:workflow — Enhanced Workflow Templates

## Purpose
Manage, validate, compose, and track workflow templates with step dependencies,
conditional logic, and execution history.

## Usage
```
/ezra:workflow list              — List all workflow templates
/ezra:workflow show <name>       — Show template details and steps
/ezra:workflow validate <name>   — Validate template structure
/ezra:workflow compose <t1> <t2> — Compose multiple templates into one workflow
/ezra:workflow run <name>        — Execute a workflow (creates a run record)
/ezra:workflow history [name]    — Show execution history
/ezra:workflow stats             — Show workflow statistics
/ezra:workflow create <name>     — Create a new workflow interactively
/ezra:workflow delete <name>     — Delete a workflow process
```

## Behavior

### List Templates
Show all available templates from `templates/` directory with name, description, and step count.

### Show Template
Parse and display full template details including:
- Metadata (name, version, author)
- Guard rails configuration
- Steps with types, dependencies, and failure handlers

### Validate
Check template for:
- Required fields (name, steps)
- Unique step IDs
- Valid step types: ezra, shell, manual, conditional, parallel, checkpoint
- Valid on_failure values: stop, skip, ask, retry
- Step dependency resolution

### Compose
Merge multiple templates into a single workflow, renumbering step IDs sequentially.
Useful for combining onboarding + security-audit into a comprehensive workflow.

### Run
Execute a workflow through the V8 execution engine (`ezra-workflow-executor.js`).
Each template step is mapped to an executor node type and dispatched:
- `ezra` steps → `action` node (`run_ezra_command`)
- `shell`/`command`/`script` steps → `action` node (`run_gate`)
- `manual`/`approval`/`review` steps → `trigger` node (manual)
- `conditional` steps → `condition` node
- `checkpoint`/`validate`/`check` steps → `gate` node
- `report` steps → `notify` node

Creates an execution record in `.ezra/processes/runs/` and tracks:
- Start time, completion time
- Steps completed/failed per step with executor output
- Current step position
- Overall status (running/completed/failed)
- Steps with `on_failure: stop` halt the workflow on failure

### History
Show all runs, optionally filtered by workflow name. Displays status, timing, and step progress.

### Stats
Show aggregate statistics:
- Total templates and active processes
- Run count, success rate
- Most used templates

## Step Types
| Type | Description |
|------|-------------|
| ezra | Execute an EZRA command |
| shell | Run a shell command |
| manual | Require manual confirmation |
| conditional | Execute based on condition |
| parallel | Run steps in parallel group |
| checkpoint | Save progress checkpoint |

## Data Source
- Templates: `templates/*.yaml`
- Processes: `.ezra/processes/active/`
- Runs: `.ezra/processes/runs/`
- Uses `hooks/ezra-workflows.js` for engine

## Cross-References
- /ezra:process — Process engine (create/run/edit workflows)
- /ezra:auto — Autonomous execution mode
