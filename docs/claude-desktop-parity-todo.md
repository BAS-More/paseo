# TODO: Claude Desktop App Parity

**PRD:** `docs/claude-desktop-parity-prd.md`
**Plan:** `docs/claude-desktop-parity-plan.md`
**Branch:** `feat/claude-desktop-parity`

Status: `[ ]` pending | `[~]` in progress | `[x]` done | `[!]` blocked

---

## Phase 0 — Foundation: Layout Mode + Light-Warm Theme (ACs: 1-3)

- [ ] **P0-01** Add `layoutMode: "workspace" | "claude-desktop"` to `AppSettings` in `hooks/use-settings.ts`
- [ ] **P0-02** Add `lightClaudeSemanticColors` to `styles/theme.ts` — warm beige palette (`#FAF9F5` bg, `#F5F4EF` surface1, `#EDECE7` surface2, `#E3E2DD` surface3, `#F0EFE9` sidebar)
- [ ] **P0-03** Add `userBubble` semantic token to all themes (transparent for non-Claude, `#F0EFE9` for light-Claude, `surface2` for dark-Claude)
- [ ] **P0-04** Build `lightClaudeTheme` using existing `commonTheme` + `lightClaudeSemanticColors`
- [ ] **P0-05** Register `lightClaude` in `styles/unistyles.ts` — add to themes map, `AppThemes` interface
- [ ] **P0-06** Add `"claudeLight"` to `ThemeName` type, `THEME_TO_UNISTYLES`, `THEME_SWATCHES` in `theme.ts`
- [ ] **P0-07** Add "Layout" section to settings screen with segmented control: Workspace | Claude Desktop
- [ ] **P0-08** Verify: new theme renders warm beige bg, all semantic tokens map correctly
- [ ] **P0-09** Verify: `npm run typecheck` passes

---

## Phase 1 — Centered Chat Column (ACs: 4-6)

- [ ] **P1-01** Create `useMaxContentWidth()` hook in `constants/layout.ts` — returns 680 if claude-desktop, 820 if workspace
- [ ] **P1-02** Replace `MAX_CONTENT_WIDTH` import with `useMaxContentWidth()` in `agent-stream-view.tsx`
- [ ] **P1-03** Replace `MAX_CONTENT_WIDTH` import with `useMaxContentWidth()` in `composer.tsx`
- [ ] **P1-04** When `layoutMode === "claude-desktop"`: workspace screen renders single agent panel only (no split panes)
- [ ] **P1-05** File/terminal/browser panels remain accessible via keyboard shortcuts even in claude-desktop mode
- [ ] **P1-06** Verify: chat column centered in available width after sidebar

---

## Phase 2 — Messages: Bubbles + Avatars (ACs: 7-10)

- [ ] **P2-01** Add bubble wrapper to `UserMessage` in `message.tsx` — `userBubble` bg, `borderRadius.xl`, padding 12-16
- [ ] **P2-02** Make bubble conditional on `layoutMode === "claude-desktop"` — workspace mode unchanged
- [ ] **P2-03** Add avatar gutter to `AssistantMessage` — 28px column at left, 12px gap, provider icon
- [ ] **P2-04** Use `ClaudeIcon` for claude provider, `getProviderIcon()` for others
- [ ] **P2-05** Make avatar conditional on `layoutMode === "claude-desktop"` — workspace mode unchanged
- [ ] **P2-06** Verify: bubbles visible in both light-warm and dark-warm Claude themes
- [ ] **P2-07** Verify: non-Claude providers show their own icon (codex, copilot, etc.)

---

## Phase 3 — Composer: Floating Pill (ACs: 11-13)

- [ ] **P3-01** Add floating pill styles to `composer.tsx` when `layoutMode === "claude-desktop"`: `borderRadius: 16`, `margin: 16`, `shadow.md`, `border: 1px surface3`
- [ ] **P3-02** Composer background: `surface1` in claude-desktop mode
- [ ] **P3-03** Model selector renders as subtle text pill at bottom-left of composer in claude-desktop mode
- [ ] **P3-04** Verify: send button shows `ArrowUp`, transforms to `Square` stop when agent running
- [ ] **P3-05** Verify: attachments, autocomplete, voice dictation still work in floating pill

---

## Phase 4 — Sidebar: Date-Grouped View (ACs: 14-17)

- [ ] **P4-01** Create `hooks/use-date-grouped-agents.ts` — groups agents by `lastActivityAt` into Today/Yesterday/7d/30d/Older
- [ ] **P4-02** Create `components/sidebar-agent-row.tsx` — title (40 char truncate), timestamp, active border
- [ ] **P4-03** Add `SidebarDateGroupedList` variant to `left-sidebar.tsx` — renders when `layoutMode === "claude-desktop"`
- [ ] **P4-04** Group headers: non-interactive text in `foregroundMuted`, `fontSize.xs`, `fontWeight.semibold`
- [ ] **P4-05** Active conversation: 3px accent left border + `surfaceSidebarHover` background
- [ ] **P4-06** Workspace mode sidebar unchanged (`SidebarWorkspaceList` still used)
- [ ] **P4-07** Verify: date groups sort correctly (Today first, Older last)

---

## Phase 5 — Empty State + Welcome (ACs: 18-20)

- [ ] **P5-01** Create `components/claude-desktop-welcome.tsx` — sparkle icon (48px), heading, 3 prompt chips
- [ ] **P5-02** Suggested prompts: "Explain this codebase", "Write tests for...", "Review this PR"
- [ ] **P5-03** Tapping a prompt chip populates composer text and auto-submits
- [ ] **P5-04** Wire welcome into `workspace-draft-agent-tab.tsx` — show when `layoutMode === "claude-desktop"` and composer empty
- [ ] **P5-05** Welcome disappears when user types or sends

---

## Phase 6 — Thinking Blocks + Tool Calls (ACs: 21-26)

- [ ] **P6-01** Verify thinking block shows "Thinking..." with animated dots during active thinking
- [ ] **P6-02** Add "Thought for Xs" duration label when thinking completes (calc from timestamps)
- [ ] **P6-03** Thinking content collapsed by default in claude-desktop mode
- [ ] **P6-04** Verify tool calls render as compact single-line summary (icon + name + brief args)
- [ ] **P6-05** Tool call status indicators: spinner (running), green check (completed), red X (failed)
- [ ] **P6-06** Tap tool call to expand full input/output detail

---

## Phase 7 — Hover Actions + Context Menu (ACs: 27-29, 35-37)

- [ ] **P7-01** Add hover action bar to message blocks (web only) — Copy button, positioned top-right
- [ ] **P7-02** On last assistant message hover: also show Retry button
- [ ] **P7-03** Actions visible only on hover, hidden on mouse leave
- [ ] **P7-04** Mobile: no hover actions (touch targets covered by other interactions)
- [ ] **P7-05** Sidebar context menu: right-click → Rename, Pin, Delete
- [ ] **P7-06** Double-click sidebar title → inline rename (TextInput replaces Text)
- [ ] **P7-07** Delete requires confirmation via `confirmDialog()`

---

## Phase 8 — Settings Modal + Keyboard Shortcuts (ACs: 30-34)

- [ ] **P8-01** Settings renders as centered modal overlay in claude-desktop mode (80% height, 600px max-width)
- [ ] **P8-02** Modal has backdrop blur + dark overlay
- [ ] **P8-03** Escape or backdrop click dismisses settings modal
- [ ] **P8-04** All existing settings sections accessible within modal
- [ ] **P8-05** Add `Cmd+Shift+C` shortcut: copy last assistant response to clipboard
- [ ] **P8-06** Add `Cmd+Shift+N` shortcut: new window (Electron only)
- [ ] **P8-07** Verify all shortcuts from PRD table are functional

---

## Phase 9 — Conversation Management

- [ ] **P9-01** Add search input at top of sidebar in claude-desktop mode — filters by title
- [ ] **P9-02** Create pinned-agents store or extend session-store — persist pinned agent IDs per server
- [ ] **P9-03** Pinned conversations render above date groups with pin icon
- [ ] **P9-04** Pin state persists across app restarts

---

## Phase 10 — Visual QA + Polish

- [ ] **P10-01** Screenshot each screen in Claude Desktop light-warm theme — compare with Claude Desktop App
- [ ] **P10-02** Fix spacing/color/typography deviations found in visual QA
- [ ] **P10-03** Verify dark-warm Claude theme (existing `darkClaude`) works with all Claude Desktop layout changes
- [ ] **P10-04** Verify mobile (xs/sm) breakpoints — sidebar full-width, composer reduced margins
- [ ] **P10-05** Performance check — no unnecessary re-renders from layout mode conditionals
- [ ] **P10-06** Run full test suite — zero regressions

---

## Completion Summary

| Phase                 | Tasks  | Status      |
| --------------------- | ------ | ----------- |
| 0 — Foundation        | 9      | Pending     |
| 1 — Chat Column       | 6      | Pending     |
| 2 — Messages          | 7      | Pending     |
| 3 — Composer          | 5      | Pending     |
| 4 — Sidebar           | 7      | Pending     |
| 5 — Welcome           | 5      | Pending     |
| 6 — Thinking/Tools    | 6      | Pending     |
| 7 — Hover/Context     | 7      | Pending     |
| 8 — Settings/Keys     | 7      | Pending     |
| 9 — Conversation Mgmt | 4      | Pending     |
| 10 — Visual QA        | 6      | Pending     |
| **Total**             | **69** | **0% done** |

**Estimated total effort: ~9.5 days**

---

## Standing Remediation Loops

Run after each phase:

```
[ ] npm run typecheck    → 0 errors
[ ] npm test             → all pass
[ ] Workspace mode       → unchanged (no regressions)
[ ] Claude Desktop mode  → new features work
[ ] Both themes          → light-warm + dark-warm render correctly
[ ] Mobile viewport      → xs/sm breakpoints work
```
