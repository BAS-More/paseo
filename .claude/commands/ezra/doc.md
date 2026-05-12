---
tier: advanced
name: ezra:doc
description: "Create, update, list, or reference SDLC documents. Usage: /ezra:doc create <type>, /ezra:doc update <type>, /ezra:doc list, /ezra:doc status, /ezra:doc check. Manages the full document lifecycle from business case through decommissioning."
---

You are managing the EZRA document registry — the central index of all project documents across the full SDLC lifecycle.

Read `.ezra/docs/registry.yaml` to understand current state. If it doesn't exist, create it using the template below.

## Argument Parsing

Parse $ARGUMENTS to determine the action:

- `/ezra:doc create <type>` → Create a new document of the specified type
- `/ezra:doc update <type>` → Update an existing document
- `/ezra:doc list` → List all documents with status
- `/ezra:doc list <phase>` → List documents for a specific phase (pre-dev, dev, post-dev)
- `/ezra:doc status` → Document health report (coverage, staleness, gaps)
- `/ezra:doc check` → Check which documents are missing for current project phase
- `/ezra:doc` (no args) → Show help

## Document Type Registry

The following document types are recognized. Each has an ID, phase, category, and criticality level.

### PRE-DEVELOPMENT — Strategic & Business
| ID | Type | Criticality |
|----|------|-------------|
| `biz-case` | Business Case / Business Plan | HIGH |
| `charter` | Project Charter | HIGH |
| `stakeholders` | Stakeholder Register | MEDIUM |
| `feasibility` | Feasibility Study | MEDIUM |

### PRE-DEVELOPMENT — Requirements & Design
| ID | Type | Criticality |
|----|------|-------------|
| `prd` | Product Requirements Document | CRITICAL |
| `user-stories` | User Stories / Use Cases | HIGH |
| `fsd` | Functional Specification | HIGH |
| `nfr` | Non-Functional Requirements | HIGH |
| `wireframes` | Wireframes / Mockups / Prototypes | MEDIUM |
| `journeys` | User Journey Maps | MEDIUM |
| `ia` | Information Architecture | MEDIUM |

### PRE-DEVELOPMENT — Technical Planning
| ID | Type | Criticality |
|----|------|-------------|
| `tad` | Technical Architecture Document | CRITICAL |
| `adr` | Architecture Decision Records | CRITICAL |
| `tech-stack` | Technology Stack Document | HIGH |
| `api-spec` | API Design Specification | HIGH |
| `data-model` | Data Model / Schema Design | HIGH |
| `security-arch` | Security Architecture Document | HIGH |
| `infra-plan` | Infrastructure Plan | HIGH |
| `integrations` | Integration Map | MEDIUM |

### PRE-DEVELOPMENT — Project Management
| ID | Type | Criticality |
|----|------|-------------|
| `roadmap` | Project Plan / Roadmap | HIGH |
| `risk-register` | Risk Register | HIGH |
| `comms-plan` | Communication Plan | LOW |
| `resource-plan` | Resource Plan | MEDIUM |
| `estimates` | Estimation Document | MEDIUM |

### DURING DEVELOPMENT — Development Standards
| ID | Type | Criticality |
|----|------|-------------|
| `coding-standards` | Coding Standards / Style Guide | HIGH |
| `branching` | Branching Strategy Document | MEDIUM |
| `contributing` | Contribution Guide | MEDIUM |
| `env-setup` | Environment Configuration Guide | HIGH |

### DURING DEVELOPMENT — Ongoing Technical
| ID | Type | Criticality |
|----|------|-------------|
| `tdd` | Technical Design Documents | HIGH |
| `api-docs` | API Documentation | HIGH |
| `migrations` | Database Migration Log | HIGH |
| `dependencies` | Dependency Register | MEDIUM |
| `config-mgmt` | Configuration Management | MEDIUM |

### DURING DEVELOPMENT — Quality & Testing
| ID | Type | Criticality |
|----|------|-------------|
| `test-strategy` | Test Strategy / Test Plan | HIGH |
| `test-cases` | Test Cases / Test Suites | MEDIUM |
| `defect-log` | Bug/Defect Log | MEDIUM |
| `qa-signoff` | QA Sign-Off Reports | HIGH |
| `perf-tests` | Performance Test Results | MEDIUM |

### DURING DEVELOPMENT — Project Tracking
| ID | Type | Criticality |
|----|------|-------------|
| `sprint-backlog` | Sprint Backlog / Task Board | HIGH |
| `retro-notes` | Sprint Retrospective Notes | LOW |
| `change-log` | Change Request Log | HIGH |
| `decision-log` | Meeting Notes / Decision Log | MEDIUM |
| `status-reports` | Progress Reports / Status Updates | MEDIUM |

### POST-DEVELOPMENT — Release & Deployment
| ID | Type | Criticality |
|----|------|-------------|
| `release-notes` | Release Notes / Changelog | HIGH |
| `deploy-runbook` | Deployment Runbook | CRITICAL |
| `go-live` | Go-Live Checklist | CRITICAL |
| `env-handover` | Environment Handover Document | HIGH |

### POST-DEVELOPMENT — Operations & Support
| ID | Type | Criticality |
|----|------|-------------|
| `ops-manual` | Operations Manual / Runbook | HIGH |
| `incident-plan` | Incident Response Plan | HIGH |
| `monitoring` | Monitoring & Alerting Configuration | HIGH |
| `dr-plan` | Backup & Disaster Recovery Plan | CRITICAL |
| `sla` | SLA/SLO Document | MEDIUM |

### POST-DEVELOPMENT — End-User Documentation
| ID | Type | Criticality |
|----|------|-------------|
| `user-guide` | User Guide / Help Documentation | HIGH |
| `admin-guide` | Admin Guide | MEDIUM |
| `faq` | FAQ / Knowledge Base | LOW |
| `onboarding` | Onboarding Guide | MEDIUM |
| `training` | Training Materials | LOW |

### POST-DEVELOPMENT — Handover & Maintenance
| ID | Type | Criticality |
|----|------|-------------|
| `handover` | Technical Handover Document | CRITICAL |
| `maintenance` | Maintenance Plan | HIGH |
| `pir` | Post-Implementation Review | MEDIUM |
| `decommission` | Decommissioning Plan | LOW |

### POST-DEVELOPMENT — Compliance & Audit
| ID | Type | Criticality |
|----|------|-------------|
| `compliance` | Compliance Evidence Pack | HIGH |
| `audit-trail` | Audit Trail / Decision Log | HIGH |
| `dpa` | Data Processing Agreement | HIGH |
| `licence-register` | Licence & IP Register | MEDIUM |

### CROSS-CUTTING — Governance & AI
| ID | Type | Criticality |
|----|------|-------------|
| `ai-usage-policy` | AI/LLM Usage & Governance Policy | HIGH |
| `prompt-library` | Prompt Engineering Library & Templates | MEDIUM |
| `agent-runbook` | Agent Orchestration Runbook | HIGH |
| `cost-model` | AI Cost Model & Budget Tracking | MEDIUM |
| `data-lineage` | Data Lineage & Flow Documentation | HIGH |
| `privacy-impact` | Privacy Impact Assessment (PIA) | HIGH |
| `accessibility` | Accessibility Compliance (WCAG) | HIGH |
| `localization` | Localization & Internationalization Guide | MEDIUM |
| `error-catalog` | Error Code Catalog & Recovery Guide | MEDIUM |
| `runbook-alerts` | Alerting Runbook & Escalation Matrix | HIGH |

### CROSS-CUTTING — DevOps & Platform
| ID | Type | Criticality |
|----|------|-------------|
| `cicd-pipeline` | CI/CD Pipeline Documentation | HIGH |
| `container-spec` | Container & Orchestration Specification | MEDIUM |
| `secrets-mgmt` | Secrets Management & Rotation Policy | HIGH |
| `network-arch` | Network Architecture & Firewall Rules | MEDIUM |
| `capacity-plan` | Capacity Planning & Scaling Strategy | MEDIUM |
| `feature-flags` | Feature Flag Inventory & Lifecycle | MEDIUM |
| `rollback-plan` | Rollback & Recovery Procedures | HIGH |
| `load-test-plan` | Load Testing Plan & Baseline Results | MEDIUM |

### CROSS-CUTTING — Team & Process
| ID | Type | Criticality |
|----|------|-------------|
| `team-charter` | Team Charter & Working Agreement | MEDIUM |
| `onboarding-dev` | Developer Onboarding Playbook | HIGH |
| `incident-postmortem` | Incident Post-Mortem Template & Log | HIGH |
| `vendor-register` | Third-Party Vendor & SaaS Register | MEDIUM |
| `tech-debt-register` | Technical Debt Register & Reduction Plan | HIGH |
| `decision-framework` | Decision-Making Framework & RACI Matrix | MEDIUM |
| `release-calendar` | Release Calendar & Freeze Schedule | MEDIUM |
| `api-versioning` | API Versioning & Deprecation Policy | HIGH |

---

## ACTION: create <type>

When creating a document:

1. Look up the document type from the registry above
2. Create the document file at `.ezra/docs/<phase>/<type-id>.md`
3. Use the appropriate template (see Templates section below)
4. Register it in `.ezra/docs/registry.yaml`
5. Report what was created

### Document File Template

Every document starts with YAML frontmatter:

```markdown
---
id: <type-id>
title: <Document Title>
phase: pre-dev | dev | post-dev
category: <category name>
criticality: CRITICAL | HIGH | MEDIUM | LOW
status: DRAFT | IN_REVIEW | APPROVED | CURRENT | STALE | SUPERSEDED
version: 1.0
created: <ISO date>
updated: <ISO date>
author: <who created it>
reviewer: <who approved it, if applicable>
linked_decisions: []  # ADR IDs this doc relates to
linked_risks: []      # Risk IDs this doc relates to
---

# <Document Title>

## Purpose
<Why this document exists and who it's for>

## Content
<The actual document content — EZRA generates initial content
based on codebase analysis and existing .ezra/ state>

## Change History
| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | <date> | EZRA | Initial creation |
```

When creating, EZRA should:
- Pre-populate content by analyzing the codebase and existing `.ezra/` state
- For `tad`, read `.ezra/knowledge.yaml` and expand into full architecture doc
- For `adr`, aggregate all `.ezra/decisions/` into a formatted ADR log
- For `risk-register`, aggregate all `.ezra/` risk data
- For `api-spec`, scan route files and generate OpenAPI-style documentation
- For `data-model`, scan schema/migration files and generate ERD descriptions
- For `test-strategy`, scan test config files and document the approach
- For `coding-standards`, read linter configs, tsconfig, and document rules
- For `deploy-runbook`, read CI/CD configs, Dockerfiles, and document steps

Always generate real content from the codebase — never create empty placeholder docs.

## ACTION: update <type>

1. Find the existing document in `.ezra/docs/`
2. Re-analyze the codebase for any changes relevant to this document type
3. Update the document content, bump version, update timestamp
4. Mark any sections that changed with `<!-- UPDATED <date> -->`
5. Update `registry.yaml`

## ACTION: list / list <phase>

Read `registry.yaml` and present:

```
EZRA DOCUMENT REGISTRY
═══════════════════════════════════════════════════
Phase: <filter or ALL>

PRE-DEVELOPMENT — Strategic & Business
  ✅ biz-case      Business Case                    v1.2  APPROVED   2026-03-15
  ❌ charter        Project Charter                  —     MISSING
  ⚠️  stakeholders  Stakeholder Register             v1.0  STALE      2025-12-01

PRE-DEVELOPMENT — Requirements & Design
  ✅ prd            Product Requirements Document    v2.0  CURRENT    2026-03-10
  ...

Coverage: <existing>/<total> (<percentage>%)
Critical gaps: <list any CRITICAL docs that are MISSING>
Stale documents: <list any docs not updated in 30+ days>
═══════════════════════════════════════════════════
```

## ACTION: status

Document health report:

```
EZRA DOCUMENT HEALTH
═══════════════════════════════════════════════════
Total Types:     81
Existing:        <n> (<pct>%)
Missing:         <n>
Stale (30+ days): <n>

BY PHASE:
  Pre-Development:  <n>/<total> (<pct>%)
  Development:      <n>/<total> (<pct>%)
  Post-Development: <n>/<total> (<pct>%)

BY CRITICALITY:
  CRITICAL: <existing>/<total>  ← MUST have these
  HIGH:     <existing>/<total>
  MEDIUM:   <existing>/<total>
  LOW:      <existing>/<total>

CRITICAL GAPS (documents you need NOW):
  ❌ <type> — <title> — <why it's needed for current phase>

STALE DOCUMENTS (not updated in 30+ days):
  ⚠️  <type> — <title> — last updated <date>

RECOMMENDATIONS:
  1. <most important doc to create next>
  2. <next>
  3. <next>
═══════════════════════════════════════════════════
```

## ACTION: check

Intelligent gap analysis based on project phase:

1. Read `.ezra/governance.yaml` to determine current project phase
2. Identify which documents are required/recommended for that phase
3. Check which exist and which are missing
4. Present a prioritized list of what to create next

## Registry File Format

`.ezra/docs/registry.yaml`:

```yaml
version: 1
last_updated: <ISO>
project_phase: pre-dev | dev | post-dev

documents:
  - id: prd
    title: Product Requirements Document
    phase: pre-dev
    category: requirements
    criticality: CRITICAL
    status: CURRENT
    version: "2.0"
    path: .ezra/docs/pre-dev/prd.md
    created: 2026-01-15
    updated: 2026-03-10
    linked_decisions: [ADR-001, ADR-005]
    linked_risks: [BL-002]
    
  - id: tad
    title: Technical Architecture Document
    phase: pre-dev
    category: technical
    criticality: CRITICAL
    status: DRAFT
    version: "1.0"
    path: .ezra/docs/pre-dev/tad.md
    created: 2026-03-19
    updated: 2026-03-19
    linked_decisions: [ADR-001, ADR-002, ADR-003]
    linked_risks: []
```

Execute automatically. Generate real content from the codebase. Never create empty placeholder documents.
