---
tier: admin
name: ezra:assess
description: Quiz2Build assessment integration — import readiness scores, gap heatmaps, and generated documents
---

# /ezra:assess

Integrates EZRA with [Quiz2Build](http://localhost:3000) — a software engineering readiness assessment platform. Quiz2Build scores projects across 7 dimensions and generates strategic documents (Architecture Dossier, SDLC Playbook, Security Framework, etc.).

## Usage

```
/ezra:assess import <sessionId>    Import an existing Quiz2Build session
/ezra:assess link <q2bProjectId>   Link this project to a Quiz2Build project
/ezra:assess sync                  Push EZRA state (decisions, scans) back to Quiz2Build
/ezra:assess score                 Re-score and update EZRA health baseline
/ezra:assess generate <docType>    Generate a Quiz2Build document and add to EZRA library
```

## Subcommands

### `import <sessionId>`

Imports a complete Quiz2Build session into EZRA:

1. Fetch readiness score → store as EZRA baseline health override in `.ezra/governance.yaml`
2. Fetch gap heatmap → convert red/amber cells to `.ezra/risks/q2b-risks.yaml` (risk register)
3. Fetch extracted facts → pre-populate `.ezra/project-definition.yaml` (skipping covered domains)
4. List which EZRA interview domains are now covered vs still needed
5. Prompt: "Run /ezra:interview to fill remaining gaps?"

**Example:**
```
/ezra:assess import sess_abc123
```

### `link <q2bProjectId>`

Links this EZRA project to a Quiz2Build project for ongoing sync:

1. Save `quiz2build.project_id` to `.ezra/settings.yaml`
2. Register EZRA's GitHub repo as a Quiz2Build evidence adapter (if `github.repo_owner` is configured)
3. Confirm: "Linked. Run /ezra:assess sync to push current state."

### `sync`

Pushes current EZRA state back to Quiz2Build as evidence facts:

1. Read `.ezra/decisions/*.yaml` → extract decision facts (architecture choices, standards adopted)
2. Read `.ezra/scans/*.yaml` → extract latest health scores, security findings
3. Read `.ezra/versions/current.yaml` → extract coverage %, test pass rate
4. Submit all facts via `/questionnaires/dynamic/:projectId`
5. Trigger score recalculation
6. Show before/after readiness score delta

### `score`

Triggers Quiz2Build re-scoring using current project state:

1. Invalidate score cache
2. Call `/scoring/calculate`
3. Fetch updated score
4. Update EZRA baseline health: save to `.ezra/governance.yaml` as `q2b_readiness_score`
5. Show: "Readiness score updated: 67 → 74 (+7)"

### `generate <docType>`

Generates a Quiz2Build document and imports it into the EZRA library:

Valid types: `architecture_dossier`, `sdlc_playbook`, `test_strategy`, `security_framework`, `api_specification`, `deployment_guide`, `data_model`, `risk_register`

1. Call `/documents/project/:projectId/generate` with the requested type
2. Download the generated document
3. Add to EZRA library as a new entry in the matching category
4. Show: "Document added to library: Architecture Dossier → category: architecture"

## Quiz2Build → EZRA Domain Mapping

When importing a session, EZRA skips interview domains already covered by Quiz2Build:

| Q2B Dimension | EZRA Interview Domains | Skip Threshold |
|---|---|---|
| Modern Architecture | tech_stack, deployment_target | MOSTLY_ADDRESSED |
| AI-Assisted Development | ai_tooling | MOSTLY_ADDRESSED |
| Coding Standards | standards_level | MOSTLY_ADDRESSED |
| Testing & QA | testing_requirements | MOSTLY_ADDRESSED |
| Security & DevSecOps | security_level | MOSTLY_ADDRESSED |
| Workflow & Operations | rollback_strategy | MOSTLY_ADDRESSED |
| Documentation | documentation_level | MOSTLY_ADDRESSED |

**EZRA-only domains** (Q2B has no equivalent): `auth_strategy`, `database_choice`, `performance_targets`, `team_size`, `timeline`, `integrations`, `compliance_requirements`

## Configuration

Add to `.ezra/settings.yaml`:

```yaml
quiz2build:
  endpoint: http://localhost:3000
  api_key: your-api-key
  project_id: q2b-project-id
  session_id: sess_abc123
  auto_sync: false           # Push facts after every phase gate
  sync_facts: true           # Include EZRA decisions as Q2B evidence
  import_documents_to_library: true
```

## Output

After `import`:
- `.ezra/risks/q2b-risks.yaml` — risk register seeded from heatmap
- `.ezra/project-definition.yaml` — updated with Q2B facts
- `.ezra/governance.yaml` — updated with `q2b_readiness_score` and `q2b_session_id`

After `sync`:
- Terminal output showing facts submitted and score delta

## Related Commands

- `/ezra:interview` — Fill remaining gaps after Q2B import
- `/ezra:health` — View EZRA health alongside Q2B readiness score
- `/ezra:library` — Browse imported Q2B documents
- `/ezra:plan generate` — Auto-generate plan from Q2B Architecture Dossier
