---
tier: admin
name: ezra:sync
description: Sync EZRA governance state with AVI-OS context
---

You are syncing EZRA governance state to the AVI-OS context MCP.

If `.ezra/` does not exist:
```
EZRA SYNC: NOT INITIALIZED
Run /ezra:init to set up governance for this project.
```
Stop here.

## Check Integration Status

Read `.ezra/governance.yaml` and check for `avios_integration.enabled: true`.

If avios integration is not enabled:
```
EZRA SYNC: AVI-OS integration is not enabled.
Add the following to .ezra/governance.yaml:

avios_integration:
  enabled: true

Then run /ezra:sync again.
```
Stop here.

## Read Pending Items

Check `.ezra/.avios-sync/pending/` for JSON files.

If the directory does not exist or is empty:
```
EZRA SYNC: No pending items.
All governance state is up to date with AVI-OS.
```
Stop here.

## Present Items for Review

Read each JSON file in `.ezra/.avios-sync/pending/` and present them grouped by action type:

```
EZRA → AVI-OS SYNC QUEUE
═══════════════════════════════════════════
Pending items: <count>

DECISIONS (<count>)
  1. [<category>] <decision> — <rationale snippet>
  2. ...

RISKS (<count>)
  1. [<category>/<impact>] <description>
  2. ...

Proceed with sync? (Y/n)
═══════════════════════════════════════════
```

Wait for user confirmation before proceeding. If the user declines, stop here.

## Execute Sync

For each pending item, call the appropriate avios-context MCP tool:

### Decision items (`action: "add_decision"`)
Call `avios_add_decision` with:
- `project_id`: from the item
- `category`: from the item (AD, DD, SC, TC)
- `decision`: from the item
- `rationale`: from the item
- `status`: "LOCKED"

### Risk items (`action: "add_risk"`)
Call `avios_update_risk` with:
- `project_id`: from the item
- `category`: from the item
- `description`: from the item
- `impact`: from the item (CRITICAL or HIGH)
- `status`: "OPEN"

### Sprint items (`action: "log_sprint_item"`)
Call `avios_log_sprint_item` with the fields from the item.

## Move Processed Items

After each successful MCP call, move the JSON file from `.ezra/.avios-sync/pending/` to `.ezra/.avios-sync/completed/`. Preserve the original filename. Create the completed directory if it does not exist.

If an MCP call fails, leave the item in pending and note the failure.

## Show Summary

```
EZRA SYNC COMPLETE
═══════════════════════════════════════════
Synced:  <count> item(s)
Failed:  <count> item(s)
Skipped: <count> item(s)

  ✓ <count> decision(s) → avios_add_decision
  ✓ <count> risk(s) → avios_update_risk
  ✓ <count> sprint item(s) → avios_log_sprint_item
  ✗ <count> failed (files remain in .ezra/.avios-sync/pending/)

Next: Run /ezra:status to verify governance state.
═══════════════════════════════════════════
```

Execute automatically after user confirmation. No additional confirmation needed for individual items.
