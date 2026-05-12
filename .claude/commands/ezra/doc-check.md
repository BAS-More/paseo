---
tier: advanced
name: ezra:doc-check
description: "Intelligent document gap analysis. Determines project phase and shows which documents are missing, required, or stale. Prioritizes by criticality."
---

You are running an EZRA document gap analysis.

If `.ezra/` does not exist, tell the user to run `/ezra:init` first and stop.

## Phase Detection

Determine the current project phase by examining:

1. `.ezra/governance.yaml` → `project_phase` if set
2. If not set, infer from codebase signals:
   - **pre-dev**: No `src/` or minimal code, mostly docs and config
   - **dev**: Active source code, test files, CI config, recent commits
   - **post-dev**: Release tags exist, deployment configs present, changelog populated, production URLs configured

## Phase-Specific Requirements

### If PRE-DEVELOPMENT
**MUST HAVE** (block on missing):
- `prd` — Product Requirements Document
- `tad` — Technical Architecture Document  
- `adr` — Architecture Decision Records
- `roadmap` — Project Plan / Roadmap
- `risk-register` — Risk Register

**SHOULD HAVE** (warn on missing):
- `biz-case` — Business Case
- `charter` — Project Charter
- `user-stories` — User Stories
- `tech-stack` — Technology Stack Document
- `api-spec` — API Design Specification
- `data-model` — Data Model / Schema Design
- `security-arch` — Security Architecture Document
- `nfr` — Non-Functional Requirements

**NICE TO HAVE**:
- `stakeholders`, `feasibility`, `wireframes`, `journeys`, `ia`
- `infra-plan`, `integrations`, `comms-plan`, `resource-plan`, `estimates`
- `container-spec`, `network-arch`, `accessibility`, `localization`
- `prompt-library`, `agent-runbook`, `cost-model`, `team-charter`, `vendor-register`

### If DURING DEVELOPMENT
**Carry forward all PRE-DEV requirements, plus:**

**MUST HAVE**:
- `coding-standards` — Coding Standards / Style Guide
- `env-setup` — Environment Configuration Guide
- `test-strategy` — Test Strategy / Test Plan
- `api-docs` — API Documentation
- `sprint-backlog` — Sprint Backlog / Task Board

**SHOULD HAVE**:
- `branching` — Branching Strategy
- `contributing` — Contribution Guide
- `tdd` — Technical Design Documents
- `migrations` — Database Migration Log
- `dependencies` — Dependency Register
- `test-cases` — Test Cases
- `change-log` — Change Request Log
- `decision-log` — Decision Log
- `cicd-pipeline` — CI/CD Pipeline Documentation
- `secrets-mgmt` — Secrets Management & Rotation Policy
- `feature-flags` — Feature Flag Inventory & Lifecycle
- `api-versioning` — API Versioning & Deprecation Policy
- `tech-debt-register` — Technical Debt Register & Reduction Plan
- `error-catalog` — Error Code Catalog & Recovery Guide
- `onboarding-dev` — Developer Onboarding Playbook

**NICE TO HAVE**:
- `config-mgmt`, `defect-log`, `qa-signoff`, `perf-tests`
- `retro-notes`, `status-reports`
- `container-spec`, `network-arch`, `accessibility`, `localization`
- `prompt-library`, `agent-runbook`, `cost-model`, `team-charter`, `vendor-register`
- `ai-usage-policy`, `privacy-impact`, `data-lineage`, `capacity-plan`, `decision-framework`

### If POST-DEVELOPMENT
**Carry forward all DEV requirements, plus:**

**MUST HAVE**:
- `release-notes` — Release Notes / Changelog
- `deploy-runbook` — Deployment Runbook
- `go-live` — Go-Live Checklist
- `ops-manual` — Operations Manual
- `dr-plan` — Backup & Disaster Recovery Plan
- `handover` — Technical Handover Document
- `user-guide` — User Guide

**SHOULD HAVE**:
- `env-handover` — Environment Handover
- `incident-plan` — Incident Response Plan
- `monitoring` — Monitoring & Alerting Configuration
- `sla` — SLA/SLO Document
- `admin-guide` — Admin Guide
- `compliance` — Compliance Evidence Pack
- `audit-trail` — Audit Trail / Decision Log
- `maintenance` — Maintenance Plan
- `rollback-plan` — Rollback & Recovery Procedures
- `runbook-alerts` — Alerting Runbook & Escalation Matrix
- `incident-postmortem` — Incident Post-Mortem Template & Log
- `load-test-plan` — Load Testing Plan & Baseline Results
- `release-calendar` — Release Calendar & Freeze Schedule

**NICE TO HAVE**:
- `faq`, `onboarding`, `training`, `pir`, `decommission`
- `dpa`, `licence-register`
- `container-spec`, `network-arch`, `accessibility`, `localization`
- `prompt-library`, `agent-runbook`, `cost-model`, `team-charter`, `vendor-register`
- `ai-usage-policy`, `privacy-impact`, `data-lineage`, `capacity-plan`, `decision-framework`

## Check Existing Documents

Read `.ezra/docs/registry.yaml` to see what exists. Cross-reference against the requirements for the detected phase.

For each existing document, check staleness:
- Updated within 7 days → FRESH
- Updated 7-30 days ago → OK
- Updated 30-90 days ago → STALE
- Updated 90+ days ago → VERY STALE
- Never updated since creation → CHECK

## Present Report

```
EZRA DOCUMENT GAP ANALYSIS
═══════════════════════════════════════════════════════════════
Detected Phase: <PHASE>
Total Document Types: 81
Existing: <n> │ Missing: <n> │ Stale: <n>

MUST HAVE — <phase>
  ✅ prd             Product Requirements Document       CURRENT    v2.0
  ✅ tad             Technical Architecture Document     FRESH      v1.1
  ❌ adr             Architecture Decision Records       MISSING
  ⚠️  roadmap        Project Plan / Roadmap              STALE      63 days
  ❌ risk-register   Risk Register                       MISSING

  Status: <n>/<total> complete │ <n> MISSING │ <n> STALE

SHOULD HAVE — <phase>
  ✅ tech-stack      Technology Stack Document           CURRENT    v1.0
  ❌ api-spec        API Design Specification            MISSING
  ❌ security-arch   Security Architecture Document      MISSING
  ...

  Status: <n>/<total> complete │ <n> MISSING │ <n> STALE

NICE TO HAVE — <phase>
  <compact list — just names and status icons>

═══════════════════════════════════════════════════════════════
PRIORITY ACTIONS (create these next):

  1. ❌ adr — Architecture Decision Records
     Why: CRITICAL for current phase. You have <n> decisions in .ezra/decisions/
     that should be formatted as a proper ADR document.
     → Run: /ezra:doc create adr

  2. ❌ risk-register — Risk Register
     Why: CRITICAL for current phase. Risks are untracked.
     → Run: /ezra:doc create risk-register

  3. ⚠️  roadmap — Project Plan / Roadmap
     Why: MUST HAVE but stale (63 days). Needs refresh.
     → Run: /ezra:doc update roadmap

  4. ❌ api-spec — API Design Specification
     Why: SHOULD HAVE. API routes exist but are undocumented.
     → Run: /ezra:doc create api-spec

  5. ❌ security-arch — Security Architecture Document
     Why: SHOULD HAVE. Auth patterns detected but undocumented.
     → Run: /ezra:doc create security-arch

═══════════════════════════════════════════════════════════════
```

Execute automatically. No confirmation needed.
