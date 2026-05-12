---
tier: admin
name: ezra:install
description: "Install, uninstall, or update EZRA in the current project"
---

# /ezra:install

Install EZRA governance framework.

## Subcommands

### install [--global]
Install EZRA hooks and commands.
- Default: installs to ~/.claude/ (global)
- Creates .ezra/ directory in current project if not exists
- Copies all hooks and command files

### uninstall
Remove EZRA hooks from Claude Code.
- Preserves .ezra/ project data (decisions, scans, settings)
- Only removes hook files and command files

### update
Update EZRA to the latest version.
- Removes old files and reinstalls from source
- Preserves all .ezra/ project data

### status
Check installation status.
- Lists installed and missing hook files
- Shows installation path

## Usage

\`\`\`
/ezra:install — install EZRA globally
/ezra:install uninstall — remove EZRA hooks
/ezra:install update — update EZRA
/ezra:install status — check installation
\`\`\`
