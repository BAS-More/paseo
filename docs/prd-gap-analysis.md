# PRD vs Paseo — Gap Analysis & TODO

**Generated:** 2026-05-08
**PRD:** Claude Desktop App UI v3 (147 features)
**Target:** Paseo at C:\Dev\tools\paseo

## Scoreboard

| Category           | HAS    | PARTIAL | MISSING | Total  |
| ------------------ | ------ | ------- | ------- | ------ |
| Design System      | 1      | 4       | 1       | 6      |
| Layout             | 3      | 1       | 1       | 5      |
| Sidebar            | 6      | 1       | 4       | 11     |
| Chat Messages      | 9      | 5       | 7       | 21     |
| Composer           | 9      | 1       | 1       | 11     |
| Model Selector     | 2      | 0       | 1       | 3      |
| Empty State        | 1      | 1       | 1       | 3      |
| Settings           | 2      | 1       | 4       | 7      |
| Keyboard Shortcuts | 3      | 2       | 0       | 5      |
| Other              | 1      | 0       | 3       | 4      |
| **TOTAL**          | **37** | **16**  | **23**  | **76** |

**49% HAS, 21% PARTIAL, 30% MISSING**

---

## P0 — MISSING (Must Build) [23 items]

### Design System

- [ ] **DS-1**: Warm beige/cream color palette — add "soifer" theme to theme.ts with warm hues (#F9F6F1 bg, #D4762A primary, #272420 fg)
  - File: `packages/app/src/styles/theme.ts`
  - Test: toggle to soifer theme → warm colors visible

### Layout

- [ ] **L-1**: Sidebar icon rail (48px collapsed) — when sidebar collapses, show icon rail with New, Search, Settings
  - File: `packages/app/src/components/left-sidebar.tsx`
  - Test: collapse sidebar → 48px rail visible with icons

### Sidebar

- [ ] **S-1**: Sidebar conversation search — add search input above workspace list
  - File: `packages/app/src/components/sidebar-workspace-list.tsx`
  - Test: type query → list filters in real-time
- [ ] **S-2**: Pin/star conversations — add pin toggle, pinned group at top
  - Files: `sidebar-workspace-list.tsx`, new store
  - Test: pin agent → appears in Pinned group → persists on reload
- [ ] **S-3**: Inline rename — click on title to edit in-place
  - File: `sidebar-workspace-list.tsx`
  - Test: click title → input appears → type → Enter saves → ESC cancels
- [ ] **S-4**: New Chat button at sidebar top
  - File: `left-sidebar.tsx`
  - Test: click → new agent created in current workspace

### Chat Messages

- [ ] **M-1**: LaTeX math rendering — add KaTeX or MathJax support
  - File: `packages/app/src/styles/markdown-styles.ts` + new dependency
  - Test: send `$E=mc^2$` → renders as math
- [ ] **M-2**: Mermaid diagram rendering
  - File: markdown renderer + new dependency
  - Test: send mermaid code block → renders as diagram
- [ ] **M-3**: "Run in shell" button on bash code blocks
  - File: message code block component
  - Test: bash block shows Run button → click → executes in terminal
- [ ] **M-4**: Edit user message & resend (branching)
  - Files: `message.tsx`, session store
  - Test: click Edit on user msg → textarea → Save → removes later msgs → resends
- [ ] **M-5**: Thinking duration label ("Thought for 12s")
  - File: tool-call-display for thinking type
  - Test: agent thinks → shows "Thought for Xs" after completion
- [ ] **M-6**: PDF file preview in messages
  - File: `message.tsx`, new PDF preview component
  - Test: attach PDF → shows card with filename + page count
- [ ] **M-7**: Message hover retry/edit/feedback buttons
  - File: `message.tsx`
  - Test: hover assistant msg → retry + copy + thumbs up/down appear

### Model Selector

- [ ] **MS-1**: Model capability badges (Most capable / Balanced / Fast)
  - File: `combined-model-selector.tsx`
  - Test: open selector → each model shows capability badge

### Empty State

- [ ] **E-1**: Suggestion cards (4-grid of starter prompts)
  - File: agent-stream-view empty state
  - Test: new agent → 4 clickable suggestion cards visible

### Settings

- [ ] **ST-1**: Font size adjustment slider
  - File: `settings-screen.tsx`
  - Test: drag slider → text resizes live
- [ ] **ST-2**: Custom instructions (global system prompt)
  - File: settings + composer
  - Test: set instruction → new agent includes it in system prompt
- [ ] **ST-3**: Privacy/data settings (clear history, memory toggle)
  - File: `settings-screen.tsx`
  - Test: clear history → agents deleted
- [ ] **ST-4**: MCP server add/remove/configure UI
  - File: settings + new MCP management screen
  - Test: add server → appears in list → remove → gone

### Other

- [ ] **O-1**: Conversation export (Markdown/JSON/TXT)
  - File: new export utility + agent menu
  - Test: export agent → downloads .md file with conversation
- [ ] **O-2**: Artifacts side panel (preview generated HTML/code)
  - File: new component
  - Test: agent generates HTML → side panel shows live preview
- [ ] **O-3**: Response style presets (concise/detailed/code-focused)
  - File: composer + settings
  - Test: select "concise" → responses are shorter

---

## P1 — PARTIAL (Needs Work) [16 items]

### Design System

- [ ] **DS-P1**: Dark mode warm charcoal — "claude" theme is close but needs tuning
  - Fix: adjust claude theme colors to match PRD charcoal spec
- [ ] **DS-P2**: Inter font — currently system-ui, add @fontsource/inter
  - Fix: install Inter, update font stack
- [ ] **DS-P3**: Shadow float tier — has sm/md/lg, add float
  - Fix: add `float` shadow to theme.ts
- [ ] **DS-P4**: Per-message appear animation — has FadeIn on container, need per-message
  - Fix: add staggered animation to individual stream items

### Layout

- [ ] **L-P1**: Sidebar default 260px — currently 320px
  - Fix: change DEFAULT_SIDEBAR_WIDTH to 260

### Sidebar

- [ ] **S-P1**: New Chat equivalent — has "Add project" but not prominent "New Chat"
  - Fix: add explicit New Chat action button at sidebar top

### Chat Messages

- [ ] **M-P1**: User message warm bubble — has bubble but zinc, not warm
  - Fix: use soifer theme tokens for user bubble bg/border
- [ ] **M-P2**: Assistant avatar inline — has provider icons but not shown next to each message
  - Fix: add small provider icon left of first assistant message in group
- [ ] **M-P3**: Hover copy button — only copy exists, add retry/edit/feedback
  - Fix: extend TurnCopyButton component with additional action buttons
- [ ] **M-P4**: Message timestamps — data exists but not displayed
  - Fix: render timestamp below messages (remove underscore prefix on prop)
- [ ] **M-P5**: Streaming caret — has working indicator but not classic text caret
  - Fix: append blinking cursor to last streamed text

### Composer

- [ ] **C-P1**: Floating card shadow — no shadow on composer container
  - Fix: add shadow-float to composer wrapper

### Empty State

- [ ] **E-P1**: Sparkle icon — uses PaseoLogo, add option for Soifer/Claude sparkle
  - Fix: add sparkle SVG alongside PaseoLogo

### Settings

- [ ] **ST-P1**: MCP config — shows NineRouter but not full MCP server management
  - Fix: extend NineRouter section to show .claude/.mcp.json servers

### Keyboard Shortcuts

- [ ] **KS-P1**: Ctrl+N → currently Cmd+Shift+O — add Ctrl+N alias
  - Fix: add alternative key binding
- [ ] **KS-P2**: Ctrl+Shift+S → currently Cmd+B — add alias
  - Fix: add alternative key binding

---

## Phase Plan

| Phase | Scope                                                               | Items                                      | Est. Hours |
| ----- | ------------------------------------------------------------------- | ------------------------------------------ | ---------- |
| A     | Soifer theme (warm palette + shadows + font)                        | DS-1, DS-P1-P4, L-P1, C-P1, M-P1, E-P1     | 3-4        |
| B     | Sidebar enhancements (search, pin, rename, icon rail, new chat)     | L-1, S-1, S-2, S-3, S-4, S-P1              | 4-5        |
| C     | Message upgrades (math, mermaid, edit, retry, timestamps, thinking) | M-1, M-2, M-4, M-5, M-P2, M-P3, M-P4, M-P5 | 6-8        |
| D     | Code + files (run in shell, PDF preview)                            | M-3, M-6                                   | 2-3        |
| E     | Model selector + empty state                                        | MS-1, E-1                                  | 2          |
| F     | Settings (font, custom instructions, privacy, MCP, export)          | ST-1, ST-2, ST-3, ST-4, O-1, ST-P1         | 4-5        |
| G     | Advanced (artifacts, response styles, keyboard aliases)             | O-2, O-3, KS-P1, KS-P2                     | 4-5        |

**Total: 39 items, ~25-33 hours**

---

## Verification Checklist (run after each phase)

```bash
# Build check
cd C:/Dev/tools/paseo && npx tsc --noEmit -p packages/server/tsconfig.server.typecheck.json

# Provider check
npx paseo provider ls

# Stack health
curl -s http://localhost:3001/api/stack-health | python -c "import sys,json;d=json.load(sys.stdin);[print(f'{k}: {v[\"status\"]}') for k,v in d['services'].items()]"

# Agent test
npx paseo agent run --provider claude --detach "say hi"

# Git clean
git status --short
```
