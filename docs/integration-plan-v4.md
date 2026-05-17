# Paseo Full-Stack Integration Plan — v4

## Executive Summary

Integrate all functionality from CC GUI (BnM-Claude-CLI), 9Router, CrewAI Bridge, and OpenClaude into Paseo as the single unified platform. TDD-first, micro-phased, with quality gates after every phase.

**Target:** 100% functional product with clean, aesthetic settings/interface.
**Method:** RED → GREEN → REFACTOR per task. No phase ships without passing gates.
**Scope:** 11 micro-phases, each ≤1 day, independently testable.

---

## Current State Audit

### What Already Exists in Paseo (verified with LOC counts)

| Component              | File                               | LOC  | Tests                       | Status                             |
| ---------------------- | ---------------------------------- | ---- | --------------------------- | ---------------------------------- |
| OCC Provider           | `providers/occ-agent.ts`           | 481  | 638 (occ-agent.test.ts)     | ✅ Complete                        |
| OCC Event Mapper       | `providers/occ/event-mapper.ts`    | 298  | included above              | ✅ Complete                        |
| CrewAI Provider        | `providers/crewai-agent.ts`        | 313  | 366 (crewai-agent.test.ts)  | ✅ Complete                        |
| CrewAI Event Mapper    | `providers/crewai/event-mapper.ts` | 89   | included above              | ✅ Complete                        |
| Gemini Provider        | `providers/gemini-agent.ts`        | 509  | 646 (gemini-agent.test.ts)  | ✅ Complete                        |
| Gemini Event Mapper    | `providers/gemini/event-mapper.ts` | 163  | included above              | ✅ Complete                        |
| 9Router Client         | `nine-router-client.ts`            | 95   | 152 (test) + 106 (messages) | ⚠️ Thin (3 endpoints)              |
| 9Router UI Section     | `nine-router-section.tsx`          | 293  | 213 (test)                  | ⚠️ Basic (health+usage)            |
| Provider Config UI     | `provider-config-section.tsx`      | 190  | 237 (test)                  | ⚠️ Minimal (3 fields per provider) |
| Provider Diagnostics   | `provider-diagnostic-sheet.tsx`    | 561  | —                           | ✅ Complete                        |
| Add Provider Modal     | `add-provider-modal.tsx`           | 327  | —                           | ✅ Complete                        |
| 9Router Status Hook    | `use-nine-router-status.ts`        | 70   | test exists                 | ✅ Complete                        |
| E2E Smoke Tests        | `e2e/*.e2e.test.ts`                | 434  | —                           | ✅ Framework exists                |
| Provider Registry      | `provider-registry.ts`             | 120+ | —                           | ✅ All 8 providers registered      |
| Provider Manifest      | `provider-manifest.ts`             | 279  | —                           | ✅ All definitions + modes         |
| CrewAI Bridge (Python) | `packages/crewai-bridge/`          | ~240 | test_api.py                 | ✅ Exists, runs standalone         |

**Total existing integration code:** ~5,800 LOC (implementations) + ~2,400 LOC (tests)

### What 9Router Actually Exposes (84 API routes)

```
CRITICAL (must integrate):
  /api/init                     — health + version
  /api/providers/client         — connections list (accounts + tokens)
  /api/keys                     — API key management (CRUD)
  /api/models                   — available models
  /api/usage                    — cost/token analytics
  /api/combos                   — provider combination rules
  /api/settings                 — global router settings

IMPORTANT (should integrate):
  /api/oauth/cursor/auto-import — import Cursor OAuth tokens
  /api/oauth/kiro/auto-import   — import Kiro tokens
  /api/oauth/iflow/cookie       — import iFlow cookies
  /api/models/alias             — model name aliases
  /api/models/test              — test model availability
  /api/providers/validate       — validate provider config
  /api/providers/test-batch     — batch test providers
  /api/pricing                  — model pricing info
  /api/cloud/credentials/update — update cloud credentials
  /api/tunnel                   — tunnel management

CLI TOOL SETTINGS (one per agent):
  /api/cli-tools/claude-settings
  /api/cli-tools/codex-settings
  /api/cli-tools/copilot-settings
  /api/cli-tools/opencode-settings
  /api/cli-tools/openclaw-settings
  /api/cli-tools/droid-settings
  /api/cli-tools/hermes-settings
  /api/cli-tools/cowork-settings
  /api/cli-tools/antigravity-mitm

DASHBOARD (for reference, not porting):
  /dashboard/providers          — provider topology view
  /dashboard/usage              — usage analytics
  /dashboard/cli-tools          — per-tool config cards
  /dashboard/proxy-pools        — pool management
  /dashboard/mitm               — MITM proxy config
  /dashboard/quota              — quota management
```

### What CC GUI Has That Paseo Needs (selective)

| Feature            | CC GUI LOC         | Paseo Equivalent   | Gap                                           |
| ------------------ | ------------------ | ------------------ | --------------------------------------------- |
| 9Router routes     | 19                 | 95 (client)        | Client exists but only 3/84 endpoints         |
| Stack settings     | 683                | —                  | No stack management in Paseo                  |
| TaskMaster         | 1490               | —                  | SKIP (not relevant to Paseo model)            |
| Plugin system      | 307                | Skills + MCP       | SKIP (Paseo has better alternative)           |
| Multi-user auth    | 171 schema + repos | —                  | SKIP (Paseo is single-user by design)         |
| Push notifications | VAPID setup        | Native mobile push | SKIP (Paseo already has native)               |
| Model constants    | 150                | Provider manifest  | Partial (manifest has modes, not models list) |
| Stack health       | in stack-settings  | —                  | Need service management panel                 |
| Provider accounts  | DB table           | —                  | Need 9Router-backed credential storage        |

### Gap Matrix

| Integration Area        | Current State                         | Target State                                                        | Effort     |
| ----------------------- | ------------------------------------- | ------------------------------------------------------------------- | ---------- |
| 9Router client          | 3 endpoints (health, accounts, usage) | 15+ endpoints covering all critical APIs                            | Medium     |
| 9Router UI              | Health dot + basic stats              | Full settings panel (providers, keys, usage, OAuth)                 | High       |
| CrewAI bridge lifecycle | Manual start (`python api.py`)        | Auto-managed by Paseo daemon                                        | Medium     |
| Provider config depth   | 3 env var fields per provider         | Full config with validation, connection test, model list            | Medium     |
| Stack orchestration     | None (external scripts)               | Service panel in settings                                           | Medium     |
| Usage analytics         | Total numbers only                    | Per-provider, per-model, time-series, cost breakdown                | Medium     |
| OAuth/token management  | None                                  | Import tokens from Cursor/Kiro/iFlow + manage credentials           | Medium     |
| Model management        | None                                  | Aliases, routing rules, availability testing                        | Low-Medium |
| CLI tool config         | None                                  | Per-agent 9Router settings (which key, which model, which provider) | Medium     |
| Visual polish           | Functional but basic                  | Clean, aesthetic, consistent with Paseo design system               | Low        |

---

## Micro-Phase Breakdown

### Phase 0: Foundation Verification (0.5 day)

**Goal:** Confirm existing integrations work end-to-end with real services.

#### Gap Analysis

Existing code was built with mocks. Never verified against live 9Router (:20128), live CrewAI bridge (:8000), or live OCC binary. Need to confirm data flows correctly before building on top.

#### Tasks

- [ ] **P0-01** Run existing E2E suite (`e2e/*.e2e.test.ts`) with all services running → document which pass/fail
- [ ] **P0-02** Manual verification: OCC provider → spawn occ → send prompt → stream events → turn completes
- [ ] **P0-03** Manual verification: CrewAI provider → connect to :8000 → list crews → SSE stream
- [ ] **P0-04** Manual verification: Gemini provider → spawn gemini → send prompt → NDJSON stream
- [ ] **P0-05** Manual verification: 9Router client → checkHealth, getAccounts, getUsage return real data
- [ ] **P0-06** Fix any runtime failures discovered (type mismatches, missing env vars, API response shape changes)
- [ ] **P0-07** Document actual 9Router API response shapes (may differ from mocked test data)

#### Quality Gate

- [ ] All 4 E2E smoke tests pass (or skip gracefully for unavailable providers)
- [ ] `npm run typecheck` passes
- [ ] No runtime crashes when services are available
- [ ] Commit: `chore(integration): verify existing provider integrations end-to-end`

---

### Phase 1: 9Router Deep Client (1 day)

**Goal:** Expand `NineRouterClient` from 3 endpoints to full critical API coverage.

#### Gap Analysis

Current client at 95 LOC only calls `/api/init`, `/api/connections`, `/api/usage`. 9Router has 84 API routes. Need coverage of: keys CRUD, models list, provider management, settings, OAuth imports, combo rules, pricing, model testing.

#### Tasks (TDD — write test first, then implement)

- [ ] **P1-01** Test + implement `getKeys()` → `GET /api/keys` → returns `NineRouterKey[]`
- [ ] **P1-02** Test + implement `createKey(name)` → `POST /api/keys` → returns new key
- [ ] **P1-03** Test + implement `deleteKey(id)` → `DELETE /api/keys/:id`
- [ ] **P1-04** Test + implement `getModels()` → `GET /api/models` → returns available models with metadata
- [ ] **P1-05** Test + implement `testModel(modelId)` → `POST /api/models/test` → returns latency + success
- [ ] **P1-06** Test + implement `getModelAliases()` / `setModelAlias(alias, target)` → `GET/POST /api/models/alias`
- [ ] **P1-07** Test + implement `getProviders()` → `GET /api/providers` → returns provider list with status
- [ ] **P1-08** Test + implement `validateProvider(id)` → `POST /api/providers/validate`
- [ ] **P1-09** Test + implement `getSettings()` / `updateSettings(patch)` → `GET/POST /api/settings`
- [ ] **P1-10** Test + implement `getCombos()` / `createCombo(combo)` / `deleteCombo(id)` → `/api/combos`
- [ ] **P1-11** Test + implement `getPricing()` → `GET /api/pricing` → model pricing table
- [ ] **P1-12** Test + implement `importOAuthToken(provider, method)` → `POST /api/oauth/:provider/auto-import`
- [ ] **P1-13** Test + implement `getCliToolSettings(tool)` / `updateCliToolSettings(tool, settings)` → `/api/cli-tools/:tool-settings`
- [ ] **P1-14** Test + implement `getVersion()` → `GET /api/version`
- [ ] **P1-15** Add request/response type definitions for all new endpoints (exported interfaces)

#### Testing

- Unit tests with `_fetchForTest` DI (mock responses) — minimum 2 tests per method (success + error)
- At least 30 new test cases total
- Coverage: ≥98% on `nine-router-client.ts`

#### Quality Gate

- [ ] `npm test` — all nine-router tests pass (existing + new)
- [ ] `npm run typecheck` — passes
- [ ] Coverage ≥98% on nine-router-client.ts
- [ ] All new methods have JSDoc with `@example`
- [ ] Commit: `feat(9router): expand client to cover keys, models, providers, settings, OAuth APIs`

---

### Phase 2: 9Router Settings UI — Providers & Keys (1 day)

**Goal:** Replace basic health dot with rich 9Router settings panel showing providers, API keys, and connection management.

#### Gap Analysis

Current UI (`nine-router-section.tsx`, 293 LOC) shows: connected/not dot, account list, usage totals, URL field. Need: provider cards with status badges, API key management (create/delete/copy), connection details per provider, model availability indicator.

#### Tasks (TDD — component tests first)

- [ ] **P2-01** Test + implement `NineRouterProvidersPanel` — grid of provider cards showing name, status, model count
- [ ] **P2-02** Test + implement `NineRouterKeyManager` — list keys, create new, delete, copy-to-clipboard
- [ ] **P2-03** Test + implement `NineRouterConnectionCard` — per-connection detail (provider, auth type, email, priority, active toggle)
- [ ] **P2-04** Test + implement `useNineRouterKeys()` hook — TanStack Query, 60s stale
- [ ] **P2-05** Test + implement `useNineRouterProviders()` hook — TanStack Query, 30s stale
- [ ] **P2-06** Test + implement `useNineRouterModels()` hook — TanStack Query, 5min stale
- [ ] **P2-07** Refactor `NineRouterSection` to use sub-panels with tab/accordion navigation
- [ ] **P2-08** Add daemon message types: `nine_router_keys_request/response`, `nine_router_providers_request/response`
- [ ] **P2-09** Wire daemon handlers to forward requests to `NineRouterClient` methods
- [ ] **P2-10** Visual polish — match Paseo's existing settings aesthetic (unistyles, consistent spacing)

#### Testing

- React Native Testing Library component tests for each panel
- Hook tests with msw or manual mocks
- Snapshot tests for key visual states (loading, empty, populated, error)

#### Quality Gate

- [ ] All new component tests pass
- [ ] Panels render correctly with mock data (verified via snapshot)
- [ ] Real data flows when 9Router is running (manual verification)
- [ ] `npm run typecheck` passes
- [ ] Commit: `feat(9router-ui): add provider cards, key manager, and connection details panels`

---

### Phase 3: 9Router Settings UI — Usage & Analytics (1 day)

**Goal:** Rich usage analytics panel with per-provider, per-model cost breakdown.

#### Gap Analysis

Current: shows 3 numbers (total requests, tokens, cost). 9Router exposes per-account breakdowns, model-level usage, and time-series data. Need visual cost tracking that helps users understand spend.

#### Tasks (TDD)

- [ ] **P3-01** Test + implement `useNineRouterUsageDetailed(period)` hook — fetches `/api/usage?period=...`
- [ ] **P3-02** Test + implement `UsageOverviewCard` — total requests, tokens, cost with period selector (24h/7d/30d)
- [ ] **P3-03** Test + implement `UsageByProviderList` — ranked list of providers by cost/requests
- [ ] **P3-04** Test + implement `UsageByModelList` — ranked list of models by usage
- [ ] **P3-05** Test + implement `CostBreakdownBar` — horizontal stacked bar showing cost distribution
- [ ] **P3-06** Test + implement `UsageTrendIndicator` — up/down arrow with percentage change vs previous period
- [ ] **P3-07** Add `nine_router_usage_detailed_request/response` daemon message type
- [ ] **P3-08** Wire daemon handler for detailed usage queries
- [ ] **P3-09** Add pricing info display — show per-model cost rates from `/api/pricing`
- [ ] **P3-10** Integrate into NineRouterSection as "Usage" tab/accordion panel

#### Testing

- Component tests with various data shapes (zero usage, single provider, many providers)
- Edge cases: NaN costs, negative values, very large numbers
- Period switching tests

#### Quality Gate

- [ ] All component + hook tests pass
- [ ] Usage panel renders correctly with real 9Router data
- [ ] Period selector works (24h/7d/30d)
- [ ] Numbers format correctly (locale-aware, currency symbols)
- [ ] Commit: `feat(9router-ui): add detailed usage analytics with provider and model breakdown`

---

### Phase 4: OAuth & Token Management (1 day)

**Goal:** Import and manage OAuth tokens from Cursor, Kiro, iFlow, and manual credentials directly in Paseo settings.

#### Gap Analysis

9Router supports auto-importing OAuth tokens from installed tools (Cursor, Kiro, iFlow). Currently no UI in Paseo to trigger these imports. Users must use 9Router's own dashboard. Need: import buttons per tool, credential status display, manual token entry.

#### Tasks (TDD)

- [ ] **P4-01** Test + implement `OAuthImportSection` — shows available OAuth sources (Cursor, Kiro, iFlow) with "Import" button
- [ ] **P4-02** Test + implement `importOAuthToken()` daemon handler → forwards to NineRouterClient
- [ ] **P4-03** Test + implement `CredentialStatusBadge` — shows token validity (valid/expired/missing)
- [ ] **P4-04** Test + implement `ManualCredentialForm` — text input for API keys with "Add" button and validation
- [ ] **P4-05** Test + implement `useOAuthImportStatus(provider)` hook — checks if local tool has tokens to import
- [ ] **P4-06** Add daemon message types: `nine_router_oauth_import_request/response`, `nine_router_credential_add_request/response`
- [ ] **P4-07** Wire daemon handlers
- [ ] **P4-08** Add confirmation dialog before importing (shows what will be imported)
- [ ] **P4-09** Add success/failure toast after import attempt
- [ ] **P4-10** Integration test: trigger import → verify 9Router received credential

#### Testing

- Component tests: import button states (available/unavailable/loading/success/error)
- Mock import flow end-to-end
- Error handling (9Router offline, import fails, invalid token)

#### Quality Gate

- [ ] All tests pass
- [ ] Import flow works with real 9Router (manual verification)
- [ ] Credentials never displayed in plain text in UI (masked)
- [ ] Commit: `feat(oauth): add token import and credential management for Cursor, Kiro, iFlow`

---

### Phase 5: CrewAI Bridge Lifecycle Management (1 day)

**Goal:** Paseo daemon auto-manages CrewAI bridge startup/shutdown. No manual `python api.py` needed.

#### Gap Analysis

Bridge at `packages/crewai-bridge/api.py` must be started manually. Paseo's CrewAI provider connects to it but can't start it. Need: daemon auto-spawns bridge on first CrewAI session, monitors health, restarts on crash, stops on daemon shutdown.

#### Tasks (TDD)

- [ ] **P5-01** Test + implement `CrewAiBridgeManager` class:
  - `start()` — spawns Python process, waits for health check
  - `stop()` — graceful shutdown with SIGTERM → SIGKILL fallback
  - `isRunning()` — checks process alive + health endpoint
  - `restart()` — stop + start
  - `getPort()` — returns bound port
- [ ] **P5-02** Test + implement auto-start: when `CrewAiAgentClient.createSession()` is called and bridge isn't running, start it
- [ ] **P5-03** Test + implement health monitoring: periodic ping (30s), auto-restart on 3 consecutive failures
- [ ] **P5-04** Test + implement Python detection: find `python3` or `python` in PATH, check version ≥3.9
- [ ] **P5-05** Test + implement dependency check: verify `fastapi`, `uvicorn` installed (pip show)
- [ ] **P5-06** Test + implement daemon lifecycle hook: stop bridge on daemon shutdown
- [ ] **P5-07** Test + implement port conflict detection: if :8000 is already bound, use next available
- [ ] **P5-08** Add `crewai_bridge_status` to daemon status response
- [ ] **P5-09** Add UI indicator in CrewAI provider config section showing bridge status
- [ ] **P5-10** Test graceful degradation: if Python not installed, show clear error in UI

#### Testing

- Unit tests with mocked `spawn` (DI via `_spawnForTest`)
- Health check polling tests with fake timers
- Process lifecycle tests (start/stop/restart/crash)
- Integration test: call `isAvailable()` → bridge auto-starts → returns true

#### Quality Gate

- [ ] All tests pass
- [ ] Bridge auto-starts when CrewAI provider selected (manual verification)
- [ ] Bridge stops cleanly on daemon shutdown
- [ ] Missing Python → helpful error message (not crash)
- [ ] Commit: `feat(crewai): auto-manage bridge lifecycle from daemon`

---

### Phase 6: Provider Configuration Enrichment (1 day)

**Goal:** Full settings UI for OCC, CrewAI, Gemini with connection testing, model listing, and validation.

#### Gap Analysis

Current `provider-config-section.tsx` (190 LOC) shows 3 text fields per provider (path/URL). Need: connection test button, model dropdown, mode selector, env var override display, binary version display, and provider-specific advanced settings.

#### Tasks (TDD)

- [ ] **P6-01** Test + implement `ProviderConnectionTest` component — "Test Connection" button that calls `isAvailable()` and shows result
- [ ] **P6-02** Test + implement `ProviderModelDropdown` — fetches models from provider, shows in picker
- [ ] **P6-03** Test + implement `ProviderVersionDisplay` — shows binary version (occ --version, gemini --version)
- [ ] **P6-04** Test + implement `ProviderEnvOverrides` — shows effective env vars passed to provider (ANTHROPIC_BASE_URL, etc.)
- [ ] **P6-05** Test + implement OCC-specific: agents file path browser, available agents list
- [ ] **P6-06** Test + implement CrewAI-specific: bridge URL + auto-start toggle + crew list display
- [ ] **P6-07** Test + implement Gemini-specific: MCP config path, project detection
- [ ] **P6-08** Expand `PROVIDER_CONFIG_FIELDS` to include all provider-specific settings
- [ ] **P6-09** Add validation on save (URL format, path exists, port range)
- [ ] **P6-10** Add "Reset to defaults" button per provider
- [ ] **P6-11** Wire config changes to daemon config persistence (save → restart provider)

#### Testing

- Component tests for each provider's expanded settings
- Validation tests (invalid URL, missing path, port out of range)
- Connection test mock flow (success/timeout/error)
- Config persistence round-trip test

#### Quality Gate

- [ ] All tests pass
- [ ] Each provider's config panel renders all settings with correct current values
- [ ] "Test Connection" works for each provider
- [ ] Config changes persist across daemon restart
- [ ] Commit: `feat(provider-config): add connection testing, model listing, and validation for all providers`

---

### Phase 7: Stack Orchestration Panel (1 day)

**Goal:** Service management panel in Paseo settings showing all stack services with start/stop/restart controls.

#### Gap Analysis

No stack management in Paseo UI. CC GUI has `stack-settings.js` (683 LOC) with service start/stop via port killing. Paseo should have a cleaner approach: show service status, allow restart, display logs snippet.

#### Tasks (TDD)

- [ ] **P7-01** Test + implement `StackService` type: `{ id, name, port, status, pid?, healthUrl, logPreview? }`
- [ ] **P7-02** Test + implement `StackServiceMonitor` class in daemon:
  - `checkService(id)` → health check + process detection
  - `getAllStatuses()` → parallel check of all 5 services
  - Periodic polling (30s)
- [ ] **P7-03** Test + implement `StackServicesPanel` UI component — list of services with status badges (green/red/yellow)
- [ ] **P7-04** Test + implement `ServiceRow` component — name, port, status dot, uptime, actions
- [ ] **P7-05** Test + implement `useStackServices()` hook — TanStack Query with 30s polling
- [ ] **P7-06** Add daemon messages: `stack_services_request/response`, `stack_service_restart_request/response`
- [ ] **P7-07** Test + implement restart action — kills process on port, waits for health
- [ ] **P7-08** Test + implement log preview — last 5 lines of service stdout (if managed by daemon)
- [ ] **P7-09** Define service registry: `[9Router, CrewAI Bridge, Soifer Backend, Paseo Daemon, Expo Metro]`
- [ ] **P7-10** Wire into settings host page as "Stack" section

#### Testing

- Service monitor tests with mocked fetch + process checks
- Component tests for all status states (up/down/starting/unknown)
- Restart flow test (mock kill + health wait)

#### Quality Gate

- [ ] All tests pass
- [ ] Panel shows correct status for all running services
- [ ] Restart action works for CrewAI bridge (the only daemon-managed service currently)
- [ ] `npm run typecheck` passes
- [ ] Commit: `feat(stack): add service orchestration panel with status monitoring and restart`

---

### Phase 8: CLI Tool Configuration via 9Router (1 day)

**Goal:** Configure each agent's 9Router routing settings (which key, model, provider) from Paseo UI.

#### Gap Analysis

9Router exposes per-CLI-tool settings (`/api/cli-tools/:tool-settings`). These control how each agent routes through 9Router. Currently not accessible from Paseo. Need: per-agent settings cards within provider config.

#### Tasks (TDD)

- [ ] **P8-01** Test + implement `useCliToolSettings(tool)` hook — fetches from NineRouterClient
- [ ] **P8-02** Test + implement `CliToolSettingsCard` — shows current routing config (key, model, provider combo)
- [ ] **P8-03** Test + implement `CliToolModelSelector` — dropdown of available models for this tool
- [ ] **P8-04** Test + implement `CliToolKeySelector` — dropdown of API keys assigned to this tool
- [ ] **P8-05** Test + implement `CliToolProviderPriority` — drag-reorder provider fallback priority
- [ ] **P8-06** Test + implement save handler — `PUT /api/cli-tools/:tool-settings`
- [ ] **P8-07** Map Paseo providers to 9Router CLI tools: claude→claude, codex→codex, copilot→copilot, occ→openclaw, opencode→opencode
- [ ] **P8-08** Add "Auto-configure" button — sets all tools to use 9Router default key + best model
- [ ] **P8-09** Show per-tool usage (requests today, cost today) from 9Router usage API
- [ ] **P8-10** Wire into provider diagnostic sheet as "9Router Routing" tab

#### Testing

- Hook tests with various settings shapes
- Component tests for selector interactions
- Save + reload round-trip test
- Auto-configure flow test

#### Quality Gate

- [ ] All tests pass
- [ ] Each provider's diagnostic sheet shows its 9Router routing settings
- [ ] Changes save and persist in 9Router
- [ ] `npm run typecheck` passes
- [ ] Commit: `feat(cli-tools): per-agent 9Router routing configuration with model and key selection`

---

### Phase 9: Model Management (0.5 day)

**Goal:** Model aliases, availability testing, and routing rules manageable from Paseo.

#### Gap Analysis

9Router supports model aliases (e.g., "best" → "claude-sonnet-4-20250514") and model testing. No Paseo UI for this. Need: alias list, create/edit alias, test model availability button.

#### Tasks (TDD)

- [ ] **P9-01** Test + implement `ModelAliasesPanel` — list of aliases with target model name
- [ ] **P9-02** Test + implement `CreateAliasForm` — alias name + target model selector
- [ ] **P9-03** Test + implement `DeleteAliasButton` — with confirmation
- [ ] **P9-04** Test + implement `ModelTestButton` — pings model, shows latency + success
- [ ] **P9-05** Test + implement `useModelAliases()` hook
- [ ] **P9-06** Wire daemon messages for model alias CRUD
- [ ] **P9-07** Add to NineRouterSection as "Models" tab

#### Testing

- Component tests for CRUD flows
- Empty state, populated state, error state
- Test button loading + result display

#### Quality Gate

- [ ] All tests pass
- [ ] Can create, view, and delete aliases
- [ ] Model test shows real latency when 9Router running
- [ ] Commit: `feat(models): model alias management and availability testing`

---

### Phase 10: Visual Polish & Design Consistency (1 day)

**Goal:** All new panels match Paseo's design language. Clean, aesthetic, no visual jank.

#### Gap Analysis

Phases 2-9 prioritize functionality. This phase ensures visual consistency: typography, spacing, color tokens, dark mode, responsive layout, loading states, error states, empty states.

#### Tasks

- [ ] **P10-01** Audit all new components against Paseo's `settingsStyles` and design tokens
- [ ] **P10-02** Ensure all panels have proper loading skeletons (not bare `ActivityIndicator`)
- [ ] **P10-03** Ensure all panels have meaningful empty states (illustration + action text)
- [ ] **P10-04** Ensure all error states show helpful message + retry button
- [ ] **P10-05** Dark mode pass — verify all new colors work in both themes
- [ ] **P10-06** Responsive pass — verify panels work on mobile (narrow viewport)
- [ ] **P10-07** Animation pass — add subtle enter/exit transitions on panels (if Paseo uses them)
- [ ] **P10-08** Icon pass — consistent icon usage (lucide-react-native set)
- [ ] **P10-09** Accessibility pass — screen reader labels, touch targets ≥44px, focus indicators
- [ ] **P10-10** Typography pass — heading hierarchy, font weight consistency

#### Quality Gate

- [ ] Visual regression screenshots taken for all new panels
- [ ] Dark mode works everywhere
- [ ] No horizontal overflow on mobile
- [ ] Touch targets ≥44px
- [ ] All interactive elements have accessible labels
- [ ] Commit: `style(settings): visual polish pass — design consistency, dark mode, accessibility`

---

### Phase 11: Coverage & Final Quality (0.5 day)

**Goal:** ≥98% coverage on all integration code. All quality gates green.

#### Tasks

- [ ] **P11-01** Run coverage report on all new/modified files
- [ ] **P11-02** Identify uncovered branches
- [ ] **P11-03** Write tests for remaining gaps (edge cases, error paths)
- [ ] **P11-04** Add coverage thresholds to vitest config for integration files
- [ ] **P11-05** Full regression: `npm test` — all tests pass (existing + new)
- [ ] **P11-06** Full typecheck: `npm run typecheck` — passes
- [ ] **P11-07** Full lint: `oxlint` — no errors
- [ ] **P11-08** E2E verification with all services running
- [ ] **P11-09** Document integration in Paseo's docs (architecture, env vars, setup)
- [ ] **P11-10** Update provider manifest if any new modes/capabilities discovered

#### Quality Gate

- [ ] Coverage ≥98% on: nine-router-client.ts, all new hooks, all new daemon handlers
- [ ] Coverage ≥90% on: all new UI components
- [ ] Zero typecheck errors
- [ ] Zero lint errors
- [ ] All E2E smoke tests pass
- [ ] Commit: `test(coverage): achieve ≥98% on all integration code`

---

## Architecture Decisions

### AD-01: 9Router as External Service (not embedded)

9Router remains a standalone Next.js app on :20128. Paseo talks to it via HTTP. Rationale: 9Router has its own auth, dashboard, and 84 API routes — embedding would be a rewrite.

### AD-02: CrewAI Bridge as Managed Child Process

Paseo daemon owns the bridge lifecycle. Rationale: eliminates manual startup, enables auto-restart, keeps single `npm run dev:win` command for full stack.

### AD-03: Provider Config via Daemon Config File

Provider settings (paths, URLs, env overrides) persisted in `$PASEO_HOME/config.json`. Rationale: aligns with existing Paseo config pattern, no DB needed for single-user.

### AD-04: UI in React Native (not web-only)

All new settings panels built with React Native primitives + unistyles. Rationale: works on mobile + desktop + web, consistent with Paseo's cross-platform approach.

### AD-05: TanStack Query for Server State

All 9Router/service data fetched via TanStack Query hooks with appropriate stale times. Rationale: existing pattern in Paseo, handles caching/refetch/error states.

### AD-06: No CC GUI Auth/Multi-User

Paseo is single-user (socket trust model). CC GUI's JWT/bcrypt auth layer is NOT ported. Rationale: different security model, Paseo uses E2E encryption for remote access instead.

### AD-07: No TaskMaster

CC GUI's TaskMaster integration (1490 LOC) is NOT ported. Rationale: Paseo has Skills + MCP for task orchestration, different paradigm.

---

## Testing Strategy

### Per-Phase TDD Cycle

```
For each task:
1. RED:   Write failing test (component, unit, or integration)
2. GREEN: Implement minimum code to pass
3. REFACTOR: Clean up, extract, optimize
4. VERIFY: typecheck + lint + full suite
```

### Test Categories

| Category                      | Tool                         | Target        |
| ----------------------------- | ---------------------------- | ------------- |
| Unit (daemon logic)           | Vitest                       | ≥98% coverage |
| Component (UI)                | React Native Testing Library | ≥90% coverage |
| Hook (data fetching)          | Vitest + mock fetch          | ≥98% coverage |
| Integration (daemon ↔ client) | Vitest + real WS             | Key flows     |
| E2E (full stack)              | Vitest e2e config            | Smoke tests   |

### Quality Gates (must pass before moving to next phase)

1. `npm run typecheck` — zero errors
2. `npm test` — all pass, no regressions
3. `oxlint` — zero errors (warnings OK)
4. Coverage threshold met for phase files
5. Manual verification with real services (documented in task)

---

## Timeline

| Phase                   | Effort        | Cumulative | Deliverable                         |
| ----------------------- | ------------- | ---------- | ----------------------------------- |
| P0: Foundation          | 0.5d          | 0.5d       | Verified working base               |
| P1: 9Router Client      | 1d            | 1.5d       | Full API client (15+ methods)       |
| P2: Providers & Keys UI | 1d            | 2.5d       | Rich provider/key management panels |
| P3: Usage Analytics UI  | 1d            | 3.5d       | Cost tracking dashboard             |
| P4: OAuth Management    | 1d            | 4.5d       | Token import flows                  |
| P5: CrewAI Lifecycle    | 1d            | 5.5d       | Auto-managed bridge                 |
| P6: Provider Config     | 1d            | 6.5d       | Full provider settings              |
| P7: Stack Orchestration | 1d            | 7.5d       | Service management panel            |
| P8: CLI Tool Config     | 1d            | 8.5d       | Per-agent routing                   |
| P9: Model Management    | 0.5d          | 9d         | Aliases + testing                   |
| P10: Visual Polish      | 1d            | 10d        | Aesthetic consistency               |
| P11: Coverage & QC      | 0.5d          | 10.5d      | 98% coverage, all gates green       |
| **Total**               | **10.5 days** |            | **100% functional**                 |

---

## Estimated Code Output

| Phase     | New LOC            | New Tests           | Files                            |
| --------- | ------------------ | ------------------- | -------------------------------- |
| P0        | ~50 (fixes)        | 0 (verify existing) | 2-3                              |
| P1        | ~400               | ~600                | 2 (client + test)                |
| P2        | ~800               | ~500                | 6 (components + hooks + tests)   |
| P3        | ~500               | ~300                | 4 (components + hook + test)     |
| P4        | ~600               | ~400                | 5 (components + hooks + tests)   |
| P5        | ~350               | ~400                | 3 (manager + test + hook)        |
| P6        | ~600               | ~400                | 6 (components + tests)           |
| P7        | ~500               | ~350                | 5 (monitor + components + tests) |
| P8        | ~450               | ~300                | 5 (hooks + components + tests)   |
| P9        | ~300               | ~200                | 3 (components + test)            |
| P10       | ~200 (style fixes) | ~50                 | 8-10 (touch-ups)                 |
| P11       | ~150 (gap tests)   | ~300                | 5-8                              |
| **Total** | **~4,900**         | **~3,800**          | **~55 files**                    |

---

## Risk Register

| Risk                                                 | Likelihood | Impact | Mitigation                                                                  |
| ---------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------- |
| 9Router API changes break client                     | Medium     | High   | Pin 9Router version during integration; version check on startup            |
| CrewAI bridge Python deps conflict                   | Medium     | Medium | Use venv; `CrewAiBridgeManager` creates isolated env                        |
| React Native component doesn't work on all platforms | Low        | Medium | Test on web + iOS during P10 polish phase                                   |
| 9Router requires auth that Paseo doesn't have        | Low        | High   | 9Router local mode has no auth; document requirement                        |
| OCC binary version mismatch                          | Medium     | Low    | Version detection + graceful degradation already in occ-agent.ts            |
| Performance: too many polling hooks                  | Low        | Medium | Consolidate to single `useNineRouterFullStatus` with stale-while-revalidate |
| Large context: settings page becomes too long        | Medium     | Low    | Use tab/accordion navigation (P10 addresses)                                |

---

## Success Criteria

The integration is **complete** when:

- [ ] All 9Router critical APIs accessible from Paseo settings UI
- [ ] Provider config panels show full settings with connection test for OCC, CrewAI, Gemini
- [ ] CrewAI bridge auto-starts when needed (no manual Python command)
- [ ] Stack services panel shows all 5 services with real-time status
- [ ] OAuth tokens importable from Cursor/Kiro/iFlow with one click
- [ ] Usage analytics show per-provider, per-model cost breakdown
- [ ] Model aliases manageable from Paseo
- [ ] Per-agent 9Router routing configurable (which key, which model)
- [ ] All UI is clean, aesthetic, consistent with Paseo design language
- [ ] Dark mode works everywhere
- [ ] Mobile layout works
- [ ] ≥98% test coverage on daemon integration code
- [ ] ≥90% test coverage on UI components
- [ ] `npm run typecheck && npm test && oxlint` all pass
- [ ] Full stack operational with single `npm run dev:win`
