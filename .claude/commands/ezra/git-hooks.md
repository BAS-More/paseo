---
tier: admin
name: ezra:git-hooks
description: "Install, remove, or check status of EZRA git hooks (pre-commit and pre-push). Usage: /ezra:git-hooks install, /ezra:git-hooks remove, /ezra:git-hooks status"
---

# Git Hooks

You are managing EZRA git hook integration.

Parse `$ARGUMENTS` for the sub-command:

- `/ezra:git-hooks install` → Install hooks
- `/ezra:git-hooks remove`  → Remove hooks
- `/ezra:git-hooks status`  → Show status

## Install

1. Find the `.git/hooks` directory relative to the project root.
1. If `.git` does not exist, tell the user: "Not a git repository. Run `git init` first."
1. For each hook (`pre-commit`, `pre-push`):
   1. If the hook file already exists and is NOT an EZRA hook, back it up to `<hook>.ezra-backup`.
   1. Write the hook file that delegates to the EZRA hook:

      ```sh
      #!/usr/bin/env sh
      # EZRA git hook — do not edit
      node "<path-to-ezra>/hooks/ezra-pre-commit.js"
      ```

   1. Make it executable: `chmod +x .git/hooks/pre-commit`

1. Report:

   ```text
   EZRA GIT HOOKS — INSTALLED
   ═══════════════════════════
     ✅ pre-commit  → hooks/ezra-pre-commit.js
     ✅ pre-push    → hooks/ezra-pre-push.js
   ```

## Remove

1. For each hook (`pre-commit`, `pre-push`):
   1. If the hook file exists and contains `# EZRA git hook`, remove it.
   1. If a `.ezra-backup` exists, restore it.

1. Report:

   ```text
   EZRA GIT HOOKS — REMOVED
   ═════════════════════════
     🗑️  pre-commit removed (backup restored: yes/no)
     🗑️  pre-push removed (backup restored: yes/no)
   ```

## Status

Check `.git/hooks/pre-commit` and `.git/hooks/pre-push`:

```text
EZRA GIT HOOKS — STATUS
════════════════════════
  pre-commit:  installed / not installed / custom (non-EZRA)
  pre-push:    installed / not installed / custom (non-EZRA)
  blocking:    true / false (from governance.yaml)
```
