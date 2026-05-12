---
tier: admin
name: ezra:memory
description: "Agent memory system — store and recall patterns, lessons, facts, and anti-patterns across sessions."
---

# /ezra:memory — Agent Memory System

## Purpose
Persistent project knowledge base that stores discovered patterns, anti-patterns,
lessons learned, and decision context across coding sessions.

## Usage
```
/ezra:memory                  — Show memory stats
/ezra:memory add <type> <content> — Add a memory entry
/ezra:memory list [type]      — List memory entries, optionally by type
/ezra:memory search <query>   — Search memory by content or tags
/ezra:memory relevant <context> — Get memories relevant to a context
/ezra:memory delete <type> <id> — Delete a memory entry
/ezra:memory archive <type> <id> — Archive (soft-delete) a memory
/ezra:memory export           — Export all memories as structured data
/ezra:memory import            — Import memories from export data
/ezra:memory init             — Initialize memory directory
```

## Memory Types
| Type | Description |
|------|-------------|
| pattern | Coding patterns to follow |
| anti-pattern | Patterns to avoid |
| lesson | Lessons learned from experience |
| decision-context | Context behind architecture decisions |
| preference | User/team preferences |
| fact | Project-specific facts |
| warning | Important warnings and caveats |

## Auto-Capture
The memory hook (`hooks/ezra-memory-hook.js`) automatically detects and captures
patterns from tool outputs. Trigger phrases include:
- "always use", "never use", "best practice"
- "lesson learned", "important:", "warning:"
- "prefer X over Y", "avoid X because Y"
- "decided to", "changed X from Y to Z"

## Data Source
- Memory storage: `.ezra/memory/` with type subdirectories
- Index: `.ezra/memory/index.yaml`
- Uses `hooks/ezra-memory.js` for core engine
- Uses `hooks/ezra-memory-hook.js` for auto-capture

## Cross-References
- /ezra:learn — Knowledge management
- /ezra:decide — Decision recording
