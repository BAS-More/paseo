# Implementation Plan: Claude Desktop App Parity

**PRD:** `docs/claude-desktop-parity-prd.md`
**Repo:** `C:\Dev\tools\paseo`
**Branch:** `feat/claude-desktop-parity`

---

## Phase 0: Foundation — Layout Mode + Light-Warm Theme

**Est: 1 day | Risk: None | ACs: 1-3**

### 0.1 Add `layoutMode` setting

- **File:** `packages/app/src/hooks/use-settings.ts`
- Add `layoutMode: "workspace" | "claude-desktop"` to `AppSettings`
- Default: `"workspace"` (no behavior change for existing users)

### 0.2 Add light-warm ("Claude Desktop") theme

- **File:** `packages/app/src/styles/theme.ts`
  - Add `lightClaudeSemanticColors` with warm beige palette (`#FAF9F5`, `#F5F4EF`, `#EDECE7`, etc.)
  - Add `userBubble` semantic token to ALL themes (transparent for non-Claude-Desktop themes, warm for Claude theme)
  - Build `lightClaudeTheme` using same `commonTheme` base
  - Add `"claudeLight"` to `ThemeName` union and `THEME_TO_UNISTYLES` map
  - Add swatch to `THEME_SWATCHES`
- **File:** `packages/app/src/styles/unistyles.ts`
  - Register `lightClaude` theme in `StyleSheet.configure`
  - Extend `AppThemes` interface

### 0.3 Wire layout mode to settings UI

- **File:** `packages/app/src/screens/settings-screen.tsx`
  - Add "Layout" section with segmented control: "Workspace" | "Claude Desktop"
  - Below theme picker

**Quality Gate:**

- [ ] New theme selectable, renders warm beige background
- [ ] Layout mode persists across restarts
- [ ] Existing themes/layouts unaffected
- [ ] `npm run typecheck` passes

---

## Phase 1: Centered Chat Column

**Est: 0.5 day | Risk: Low | ACs: 4-6**

### 1.1 Conditional MAX_CONTENT_WIDTH

- **File:** `packages/app/src/constants/layout.ts`
  - Export `useMaxContentWidth()` hook: returns 680 if `claude-desktop`, 820 otherwise
- **File:** `packages/app/src/components/agent-stream-view.tsx`
  - Replace `MAX_CONTENT_WIDTH` constant with `useMaxContentWidth()` hook
- **File:** `packages/app/src/components/composer.tsx`
  - Same replacement

### 1.2 Hide multi-pane splits in Claude Desktop mode

- **File:** `packages/app/src/screens/workspace/` (workspace tab/pane management)
  - When `layoutMode === "claude-desktop"`, render only agent panel (single pane)
  - File/terminal/browser panels still openable via keyboard shortcuts

**Quality Gate:**

- [ ] Chat column visibly narrower and centered
- [ ] No file/terminal panes visible by default in Claude Desktop mode
- [ ] Workspace mode unchanged
- [ ] Keyboard shortcut still opens terminal/file panels

---

## Phase 2: Message Styling — Bubbles + Avatars

**Est: 1.5 days | Risk: Low | ACs: 7-10**

### 2.1 User message bubbles

- **File:** `packages/app/src/components/message.tsx` — `UserMessage` component
  - When `layoutMode === "claude-desktop"`:
    - Wrap content in `View` with `backgroundColor: theme.colors.userBubble`, `borderRadius: 12`, `padding: 12-16`
    - Right-align bubble (or full-width with subtle background — match Claude Desktop)
  - When `layoutMode === "workspace"`: no change

### 2.2 Assistant message avatars

- **File:** `packages/app/src/components/message.tsx` — `AssistantMessage` component
  - When `layoutMode === "claude-desktop"`:
    - Add avatar gutter (28px wide) at left of message
    - Show provider icon from `getProviderIcon()` (Claude sparkle for claude provider)
    - Message content indented after avatar column
  - When `layoutMode === "workspace"`: no change

### 2.3 Add `userBubble` token to all themes

- **File:** `packages/app/src/styles/theme.ts`
  - Light standard: `"transparent"` (no bubble bg)
  - Light Claude: `"#F0EFE9"`
  - All dark themes: map to `surface2` or a dedicated warm variant
  - Wire through `buildDarkSemanticColors` and `DarkThemeConfig`

**Quality Gate:**

- [ ] User messages visually distinct with rounded bubble in Claude Desktop mode
- [ ] Claude avatar sparkle icon visible next to assistant responses
- [ ] Other providers show their own icon
- [ ] Workspace mode messages unchanged

---

## Phase 3: Composer — Floating Pill

**Est: 1 day | Risk: Low | ACs: 11-13**

### 3.1 Floating composer variant

- **File:** `packages/app/src/components/composer.tsx`
  - When `layoutMode === "claude-desktop"`:
    - Container gets: `borderRadius: 16`, `marginHorizontal: 16`, `marginBottom: 16`, `shadow.md`, `border: 1px surface3`
    - Background: `surface1` (slightly elevated from `surface0`)
  - When `layoutMode === "workspace"`: existing styles

### 3.2 Model selector pill

- **File:** `packages/app/src/components/combined-model-selector.tsx`
  - When `layoutMode === "claude-desktop"`:
    - Render as subtle text pill at bottom-left of composer: "Claude 3.5 Sonnet" in `foregroundMuted` + `fontSize.xs`
    - Tappable to open model picker dropdown
  - When `layoutMode === "workspace"`: existing rendering

### 3.3 Send/Stop button transition

- Already exists in Paseo (`ArrowUp` / `Square` icons in composer). Verify:
  - Send button uses `accent` color
  - Stop button uses `destructive` or `accent` color
  - Transition is immediate (no animation needed)

**Quality Gate:**

- [ ] Composer floats with rounded corners and shadow
- [ ] Model selector visible as subtle pill text
- [ ] Send→Stop transition works
- [ ] Composer functional: typing, attachments, autocomplete all work

---

## Phase 4: Sidebar — Date-Grouped View

**Est: 1.5 days | Risk: Medium | ACs: 14-17**

### 4.1 Date grouping logic

- **File:** New `packages/app/src/hooks/use-date-grouped-agents.ts`
  - Takes agent list from session store
  - Groups by `lastActivityAt` into buckets: "Today", "Yesterday", "Previous 7 Days", "Previous 30 Days", "Older"
  - Returns `Array<{ label: string; agents: Agent[] }>`

### 4.2 Date-grouped sidebar variant

- **File:** `packages/app/src/components/left-sidebar.tsx`
  - When `layoutMode === "claude-desktop"`:
    - Replace `SidebarWorkspaceList` with new `SidebarDateGroupedList`
    - Each group renders header text + flat list of agent rows
    - Agent row shows: title (truncated, 40 chars), subtitle (time), active indicator (accent left border)
  - When `layoutMode === "workspace"`: existing `SidebarWorkspaceList`

### 4.3 New sidebar agent row component

- **File:** New `packages/app/src/components/sidebar-agent-row.tsx`
  - Single-line title, muted timestamp
  - Active state: accent left border or subtle background highlight
  - Right-click context menu (rename, pin, delete)

### 4.4 Active conversation highlight

- Accent left border (3px) on active conversation
- Background: `surfaceSidebarHover` on active

**Quality Gate:**

- [ ] Sidebar groups agents by date in Claude Desktop mode
- [ ] Group headers non-interactive
- [ ] Active agent highlighted with accent border
- [ ] Workspace mode sidebar unchanged

---

## Phase 5: Empty State + Welcome

**Est: 0.5 day | Risk: None | ACs: 18-20**

### 5.1 Welcome draft component

- **File:** New `packages/app/src/components/claude-desktop-welcome.tsx`
  - Large Claude sparkle icon (48px)
  - "How can I help you today?" heading
  - 3 suggested prompt chips: "Explain this codebase", "Write tests for...", "Review this PR"
  - Chips are `Pressable` — tapping populates composer and auto-sends
  - Disappears when user types or sends

### 5.2 Wire into draft panel

- **File:** `packages/app/src/screens/workspace/workspace-draft-agent-tab.tsx`
  - When `layoutMode === "claude-desktop"` and composer empty:
    - Render `ClaudeDesktopWelcome` above composer
  - When user types: hide welcome, show empty stream view

**Quality Gate:**

- [ ] Welcome screen visible on new conversation
- [ ] Suggested prompts tappable and functional
- [ ] Welcome disappears on input

---

## Phase 6: Thinking Blocks + Tool Calls Polish

**Est: 1 day | Risk: Low | ACs: 21-26**

### 6.1 Thinking block duration labels

- **File:** `packages/app/src/components/message.tsx` — thought rendering
  - Verify "Thinking..." label with animated dots during active thinking
  - Add "Thought for Xs" label when thinking completes (calculate from start/end timestamps)
  - Collapsed by default — tap/click to expand

### 6.2 Tool call compact inline style

- **File:** `packages/app/src/components/message.tsx` — `ToolCall` component
  - When `layoutMode === "claude-desktop"`:
    - Single-line summary: `[icon] ToolName — brief args`
    - Status: spinner (running), green check (completed), red X (failed)
    - Tap to expand full detail
  - Verify existing behavior covers this (Paseo already has collapsible tool calls)

**Quality Gate:**

- [ ] Thinking blocks show duration when complete
- [ ] Tool calls compact by default
- [ ] Expand/collapse works
- [ ] Animated dots during active thinking

---

## Phase 7: Hover Actions + Context Menu

**Est: 0.5 day | Risk: None | ACs: 27-29, 35-37**

### 7.1 Message hover actions (desktop only)

- **File:** `packages/app/src/components/message.tsx`
  - Wrap message blocks in a hoverable container (web only)
  - On hover: show floating action bar with Copy button
  - On last assistant message: also show Retry button
  - Actions: absolute positioned, top-right of message block

### 7.2 Sidebar context menu

- **File:** `packages/app/src/components/sidebar-agent-row.tsx` (new from Phase 4)
  - Right-click: Rename, Pin to top, Delete
  - Double-click title: enter inline rename (TextInput replaces Text)
  - Delete: confirmation dialog via `confirmDialog()`

**Quality Gate:**

- [ ] Hover shows copy button on messages (desktop)
- [ ] Right-click sidebar opens context menu
- [ ] Inline rename works
- [ ] Delete requires confirmation

---

## Phase 8: Settings Modal + Keyboard Shortcuts

**Est: 0.5 day | Risk: Low | ACs: 30-34**

### 8.1 Settings as modal overlay

- **File:** `packages/app/src/screens/settings-screen.tsx`
  - When `layoutMode === "claude-desktop"`:
    - Render as a centered modal overlay (80% height, 600px max-width)
    - Backdrop blur + dark overlay
    - Escape or backdrop click to dismiss
  - When `layoutMode === "workspace"`: existing full-screen navigation

### 8.2 Missing keyboard shortcuts

- **File:** `packages/app/src/keyboard/` + settings
  - Verify `Cmd+Shift+C` (copy last response) — add if missing
  - Verify `Cmd+Shift+N` (new window) — add if Electron supports it
  - All other shortcuts already exist per audit

**Quality Gate:**

- [ ] Settings opens as modal in Claude Desktop mode
- [ ] Escape dismisses settings modal
- [ ] All keyboard shortcuts from PRD functional

---

## Phase 9: Conversation Management

**Est: 0.5 day | Risk: Low | ACs: 35-37**

### 9.1 Conversation search

- **File:** `packages/app/src/components/left-sidebar.tsx`
  - Add search input at top of sidebar (below header)
  - Filters agent list by title match
  - Only in Claude Desktop mode (workspace mode has its own filtering)

### 9.2 Pin conversations

- **File:** `packages/app/src/stores/session-store.ts` or new pinned-agents store
  - Persist pinned agent IDs per server
  - Pinned agents appear at top of sidebar before date groups

**Quality Gate:**

- [ ] Search filters sidebar in real-time
- [ ] Pinned conversations stick to top
- [ ] Pin persists across restarts

---

## Phase 10: Polish + Visual QA

**Est: 1 day | Risk: None**

### 10.1 Visual QA pass

- Screenshot each screen in Claude Desktop mode
- Compare with Claude Desktop App screenshots
- Fix spacing, colors, typography deviations

### 10.2 Dark mode QA

- Verify Claude Desktop mode works in both light-warm and dark-warm themes
- Fix any contrast issues

### 10.3 Mobile QA

- Verify Claude Desktop mode on xs/sm breakpoints
- Sidebar should be full-width overlay on mobile (existing behavior)
- Composer should still be at bottom with reduced margins

### 10.4 Performance check

- No unnecessary re-renders from layout mode checks
- Memoize layout-mode-dependent styles

**Quality Gate:**

- [ ] Visual parity with Claude Desktop App (<5% divergence)
- [ ] Works in light + dark Claude themes
- [ ] Works on mobile viewports
- [ ] No perf regressions

---

## Execution Order

| Step      | Phase | What                           | Est           | Commit message                                                     |
| --------- | ----- | ------------------------------ | ------------- | ------------------------------------------------------------------ |
| 1         | 0     | Layout mode + light-warm theme | 1d            | `feat(theme): add claude-desktop layout mode and light-warm theme` |
| 2         | 1     | Centered chat column           | 0.5d          | `feat(layout): centered 680px chat column for claude-desktop mode` |
| 3         | 2     | Message bubbles + avatars      | 1.5d          | `feat(messages): user bubbles and provider avatars`                |
| 4         | 3     | Floating composer              | 1d            | `feat(composer): floating pill variant for claude-desktop mode`    |
| 5         | 4     | Date-grouped sidebar           | 1.5d          | `feat(sidebar): date-grouped conversation list`                    |
| 6         | 5     | Empty state + welcome          | 0.5d          | `feat(welcome): claude-desktop empty state with suggested prompts` |
| 7         | 6     | Thinking + tool calls          | 1d            | `feat(messages): thinking duration labels and compact tool calls`  |
| 8         | 7     | Hover actions + context menu   | 0.5d          | `feat(messages): hover actions and sidebar context menu`           |
| 9         | 8     | Settings modal + shortcuts     | 0.5d          | `feat(settings): modal overlay for claude-desktop mode`            |
| 10        | 9     | Conversation mgmt              | 0.5d          | `feat(sidebar): search, pin, rename conversations`                 |
| 11        | 10    | Visual QA + polish             | 1d            | `fix(theme): visual parity polish pass`                            |
| **Total** |       |                                | **~9.5 days** |                                                                    |

---

## Key Files Created/Modified

### New Files

| File                                    | Phase | LOC |
| --------------------------------------- | ----- | --- |
| `hooks/use-date-grouped-agents.ts`      | 4     | ~60 |
| `components/sidebar-agent-row.tsx`      | 4     | ~80 |
| `components/claude-desktop-welcome.tsx` | 5     | ~80 |

### Modified Files

| File                                              | Phase   | Change                                    |
| ------------------------------------------------- | ------- | ----------------------------------------- |
| `styles/theme.ts`                                 | 0, 2    | Add light-warm theme + `userBubble` token |
| `styles/unistyles.ts`                             | 0       | Register new theme                        |
| `hooks/use-settings.ts`                           | 0       | Add `layoutMode` setting                  |
| `constants/layout.ts`                             | 1       | Add `useMaxContentWidth()` hook           |
| `components/message.tsx`                          | 2, 6, 7 | Bubbles, avatars, thinking, hover         |
| `components/composer.tsx`                         | 3       | Floating pill variant                     |
| `components/combined-model-selector.tsx`          | 3       | Subtle pill variant                       |
| `components/left-sidebar.tsx`                     | 4, 9    | Date-grouped + search                     |
| `screens/settings-screen.tsx`                     | 0, 8    | Layout setting + modal                    |
| `screens/workspace/workspace-draft-agent-tab.tsx` | 5       | Welcome state                             |

---

## Risk Register

| Risk                                        | Likelihood | Impact | Mitigation                                                          |
| ------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------- |
| Layout mode conditionals bloat components   | Medium     | Medium | Extract variants into separate sub-components, not inline ternaries |
| Light-warm theme contrast issues            | Low        | Medium | WCAG AA check on all text/bg combos at theme creation time          |
| Date grouping perf with many agents         | Low        | Low    | Memoize grouping, limit to 100 most recent                          |
| Workspace features accidentally hidden      | Medium     | High   | Keyboard shortcuts always work regardless of layout mode            |
| Mobile layout breaks in Claude Desktop mode | Low        | Medium | Test xs/sm breakpoints in Phase 10                                  |
