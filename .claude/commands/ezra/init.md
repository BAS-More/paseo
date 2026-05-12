---
tier: core
name: ezra:init
description: Initialize EZRA governance for this project. Scans codebase architecture, creates .ezra/ state directory, and establishes baseline knowledge.
---

You are initializing EZRA for this project.

## Phase 1: Create State Directory

Create the `.ezra/` directory structure if it does not exist:

```
.ezra/
├── decisions/          # Will hold architectural decision records
├── scans/              # Will hold timestamped scan results
├── plans/              # Will hold registered plans for reconciliation
├── governance.yaml     # Governance rules and protected paths
└── knowledge.yaml      # Codebase knowledge — what EZRA knows
```

## Phase 2: Codebase Discovery

Scan the project to build initial knowledge. Read the following:

1. **Project root files**: package.json, tsconfig.json, Cargo.toml, pyproject.toml, go.mod, Makefile, docker-compose.yml, .env.example — whatever exists
2. **Directory structure**: Map the top-level and second-level directories
3. **Entry points**: Identify main entry files (src/index.ts, src/main.ts, app.ts, main.py, etc.)
4. **Configuration**: CI/CD files (.github/workflows/, azure-pipelines.yml), linting configs, test configs
5. **Existing documentation**: README.md, CLAUDE.md, ARCHITECTURE.md, ADR files, docs/ directory

## Phase 3: Architecture Analysis

Using the discovered files, determine:

1. **Language & Runtime**: Primary language, version, runtime
2. **Framework**: Web framework, ORM, test framework, build tool
3. **Architecture Pattern**: Monolith, microservices, monorepo, serverless, etc.
4. **Layer Structure**: Routes/Controllers → Services → Repositories → Models (or equivalent)
5. **External Dependencies**: Databases, caches, message queues, cloud services, APIs
6. **Test Infrastructure**: Test runner, coverage tool, E2E framework, test directory structure

## Phase 4: Write Initial State

Write `governance.yaml` with sensible defaults:

```yaml
# .ezra/governance.yaml
version: 1
initialized: <ISO timestamp>
project:
  name: <from package.json or directory name>
  language: <detected>
  framework: <detected>

protected_paths:
  # Paths that require explicit decision records before modification
  - pattern: "*.env*"
    reason: "Environment configuration — changes affect all environments"
  - pattern: "docker-compose*.yml"
    reason: "Infrastructure definition — changes affect deployment"
  - pattern: "**/migrations/**"
    reason: "Database migrations — irreversible in production"
  - pattern: ".github/workflows/**"
    reason: "CI/CD pipeline — changes affect all deployments"

enforcement:
  require_decision_for_protected_paths: true
  require_reconciliation_before_merge: false
  auto_scan_on_init: true

standards:
  # Detected or default coding standards
  strict_types: true
  no_any: true
  test_coverage_minimum: 80
```

Write `knowledge.yaml` with discovered state:

```yaml
# .ezra/knowledge.yaml
version: 1
last_scan: <ISO timestamp>
confidence: initial

architecture:
  language: <detected>
  runtime: <detected>
  framework: <detected>
  pattern: <detected>
  layers: <list of detected layers>

entry_points:
  - <list of main entry files>

dependencies:
  external_services: <list>
  databases: <list>
  key_packages: <top 10 most important dependencies>

test_infrastructure:
  runner: <detected>
  coverage_tool: <detected>
  e2e_framework: <detected or "none">
  test_directories: <list>

risks:
  # Initial risk assessment
  - <any detected risks like missing tests, no CI, no types, etc.>
```

## Phase 5: Initialize Settings

Write `.ezra/settings.yaml` with unified defaults:

```yaml
# .ezra/settings.yaml — Unified EZRA settings
standards:
  typescript_strict: true
  no_any: true
  naming: kebab-case
  error_handling: mandatory
  max_complexity: 10
  test_coverage_minimum: 80
  custom_rules: []

security:
  profile: standard
  require_auth_on_all_routes: false
  secrets_scanning: true
  input_validation: true
  rate_limiting: true
  custom_rules: []

oversight:
  enabled: true
  level: warn
  health_threshold: 75
  auto_pause_on_critical: true
  review_every_n_files: 5
  excluded_paths:
    - "*.test.ts"
    - "*.spec.ts"
    - "docs/*"
  notify_on:
    - critical
    - high

best_practices:
  enabled: true
  suggest_frequency: daily
  domains:
    - architecture
    - security
    - testing
  auto_suggest: true

workflows:
  active_templates: []
  auto_run: false
  approval_gates: false
```

## Phase 6: Update .gitignore

Add `.ezra/settings.yaml` to the project's `.gitignore` (or create one if absent). This file can contain API keys, tokens, and per-developer preferences that must not be committed.

```
# Append to .gitignore
# EZRA per-project settings (may contain secrets/tokens)
.ezra/settings.yaml
```

Also add `.ezra/execution/` if the project will use autonomous execution mode (contains run state).

## Phase 7: Report

Present a compact summary:

```
EZRA INITIALIZED
═══════════════════════════════════════════
Project: <name>
Language: <lang> | Framework: <framework>
Architecture: <pattern>
Layers: <detected layers>
Protected Paths: <count> configured
Decisions: 0 recorded
Knowledge Confidence: INITIAL
═══════════════════════════════════════════
Next: Run /ezra:scan for deep analysis
      Run /ezra:decide to record architectural decisions
```

Do NOT ask for confirmation before starting. Execute all phases automatically.
